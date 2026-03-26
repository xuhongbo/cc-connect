import type { ChatInputCommandInteraction, TextChannel } from 'discord.js';
import type { BootstrapResult } from '../../../app/bootstrap.js';
import type { AttachmentRef } from '../../../domain/last-turn.js';
import type { AgentKind, Project } from '../../../domain/project.js';
import type { createPermissionActions } from '../../interactions/permission-actions.js';

type SessionPermissionActions = ReturnType<typeof createPermissionActions>;

export interface SessionCommandHandlerContext {
  app: BootstrapResult;
  permissionActions: SessionPermissionActions;
  interaction: ChatInputCommandInteraction;
  replyOnce: (content: string) => Promise<void>;
}

export async function handleSessionCommand(context: SessionCommandHandlerContext): Promise<void> {
  const subcommand = context.interaction.options?.getSubcommand?.();
  if (!subcommand) {
    return;
  }

  if (subcommand === 'new') {
    await handleSessionNew(context);
    return;
  }

  if (subcommand === 'status') {
    await handleSessionStatus(context);
    return;
  }

  if (subcommand === 'cancel') {
    await handleSessionCancel(context);
    return;
  }

  if (subcommand === 'list') {
    await handleSessionList(context);
    return;
  }

  if (subcommand === 'restart') {
    await handleSessionRestart(context);
    return;
  }

  if (subcommand === 'retry') {
    await handleSessionRetry(context);
    return;
  }
}

async function handleSessionNew(context: SessionCommandHandlerContext): Promise<void> {
  const { interaction, app, replyOnce } = context;
  const project = await app.repos.projects.getByChannelId(interaction.channelId);
  if (!project) {
    await replyOnce('当前频道不是项目频道，无法创建会话线程');
    return;
  }
  const channelWithThreads = interaction.channel as TextChannel | null;
  if (!channelWithThreads?.threads?.create) {
    await replyOnce('当前频道不支持创建线程');
    return;
  }

  const selectedAgent = (interaction.options?.getString?.('agent') as AgentKind | undefined) || project.defaultAgent;
  const titleSuffix = interaction.options?.getString?.('title') || `${selectedAgent}-${Date.now()}`;
  const requestedTitle = titleSuffix;
  const thread = await channelWithThreads.threads.create({
    name: requestedTitle,
    autoArchiveDuration: 1440,
    reason: 'cc-connect 会话创建',
  });
  await app.orchestrator.createConversationThread({
    project,
    agentKind: selectedAgent,
    ownerUserId: interaction.user?.id ?? 'unknown',
    createdFrom: 'command',
    threadId: thread.id,
    requestedTitle,
  });
  await replyOnce(`已创建线程：<#${thread.id}>`);
}

async function handleSessionStatus(context: SessionCommandHandlerContext): Promise<void> {
  const { interaction, app, replyOnce } = context;
  const record = await app.repos.threads.getByThreadId(interaction.channelId);
  if (!record) {
    await replyOnce('当前线程未绑定会话');
    return;
  }
  const binding = await app.repos.bindings.getByThreadRecordId(record.id);
  const runtimeState = await app.repos.runtimeStates.getByThreadRecordId(record.id);
  await replyOnce([
    `线程：${record.threadTitle}`,
    `代理：${record.agentKind}`,
    `会话ID：${binding?.agentSessionId || '未建立'}`,
    `进程状态：${binding?.processState || 'unknown'}`,
    `忙碌：${runtimeState?.isBusy ? '是' : '否'}`,
    `错误：${runtimeState?.lastError || '无'}`,
  ].join('\n'));
}

async function handleSessionCancel(context: SessionCommandHandlerContext): Promise<void> {
  const { interaction, app, replyOnce, permissionActions } = context;
  const record = await app.repos.threads.getByThreadId(interaction.channelId);
  if (!record) {
    await replyOnce('当前线程未绑定会话');
    return;
  }
  await permissionActions.cancelThread(record.id);
  await replyOnce('已发送取消请求');
}

async function handleSessionList(context: SessionCommandHandlerContext): Promise<void> {
  const { interaction, app, replyOnce } = context;
  const project = await resolveProjectForChannel(app, interaction.channelId);
  if (!project) {
    await replyOnce('当前频道不是项目频道，也不属于已知项目线程');
    return;
  }
  const threads = await app.repos.threads.listByProjectId(project.id);
  const text = threads.length === 0
    ? '当前项目还没有会话线程'
    : threads.map((thread) => `- ${thread.threadTitle} (${thread.status})`).join('\n');
  await replyOnce(text);
}

async function handleSessionRestart(context: SessionCommandHandlerContext): Promise<void> {
  const { interaction, app, replyOnce } = context;
  const record = await app.repos.threads.getByThreadId(interaction.channelId);
  if (!record) {
    await replyOnce('当前线程未绑定会话');
    return;
  }
  const runtime = app.sessions.getRuntime(record.id);
  if (runtime) {
    await runtime.close().catch(() => undefined);
    app.sessions.clearRuntime(record.id);
  }
  const binding = await app.repos.bindings.getByThreadRecordId(record.id);
  if (binding) {
    await app.repos.bindings.upsert({
      ...binding,
      agentSessionId: '',
      processState: 'not_started',
      updatedAt: new Date().toISOString(),
    });
  }
  const runtimeState = await app.repos.runtimeStates.getByThreadRecordId(record.id);
  if (runtimeState) {
    await app.repos.runtimeStates.upsert({
      ...runtimeState,
      isBusy: false,
      lastError: '',
      updatedAt: new Date().toISOString(),
    });
  }
  await replyOnce('已重置会话绑定，下一轮消息会重新启动代理');
}

async function handleSessionRetry(context: SessionCommandHandlerContext): Promise<void> {
  const { interaction, app, replyOnce } = context;
  const record = await app.repos.threads.getByThreadId(interaction.channelId);
  if (!record) {
    await replyOnce('当前线程未绑定会话');
    return;
  }
  const project = await app.repos.projects.getById(record.projectId);
  if (!project) {
    await replyOnce('找不到对应项目');
    return;
  }
  const lastTurn = app.sessions.getLastTurnSnapshot(record.id);
  if (!lastTurn) {
    await replyOnce('当前线程没有可重试的上一轮输入');
    return;
  }
  if (!app.sessions.tryBeginTurn(record.id)) {
    await replyOnce('当前线程正忙，请稍后重试');
    return;
  }

  try {
    const binding = await app.repos.bindings.getByThreadRecordId(record.id);
    if (!binding) {
      throw new Error('找不到会话绑定');
    }
    const adapter = app.agents.get(binding.agentKind);
    if (!adapter) {
      throw new Error(`找不到代理适配器：${binding.agentKind}`);
    }
    const runtime = app.sessions.getRuntime(record.id) ?? await adapter.createSession({
      workDir: project.currentWorkDir || project.baseWorkDir,
      binding,
      projectContext: {
        projectId: project.id,
        defaultAgent: project.defaultAgent,
        defaultModel: project.defaultModel,
        defaultMode: project.defaultMode,
      },
      lastTurn,
    });
    app.sessions.setRuntime(record.id, runtime);
    app.eventPump.ensurePump(record.id, runtime, (threadRecordId, event) =>
      app.orchestrator.syncRuntimeEvent(threadRecordId, event),
    );
    await runtime.send({
      text: lastTurn.userMessageText,
      ...attachmentRefsToRuntimeInput(lastTurn.attachmentRefs),
    });
    await replyOnce('已重新发送上一轮输入');
  } catch (error) {
    app.sessions.finishTurn(record.id);
    throw error;
  }
}

async function resolveProjectForChannel(app: BootstrapResult, channelId: string): Promise<Project | null> {
  const project = await app.repos.projects.getByChannelId(channelId);
  if (project) {
    return project;
  }
  const thread = await app.repos.threads.getByThreadId(channelId);
  if (!thread) {
    return null;
  }
  return app.repos.projects.getById(thread.projectId);
}

function attachmentRefsToRuntimeInput(attachmentRefs: AttachmentRef[]) {
  return {
    files: attachmentRefs
      .filter((ref) => ref.kind === 'file')
      .map((ref) => ({ name: ref.name, originalName: ref.originalName, path: ref.path })),
    images: attachmentRefs
      .filter((ref) => ref.kind === 'image')
      .map((ref) => ({
        name: ref.name,
        originalName: ref.originalName,
        path: ref.path,
        mimeType: ref.mimeType || 'image/png',
      })),
  };
}
