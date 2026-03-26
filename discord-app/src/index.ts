import 'dotenv/config';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { bootstrap } from './app/bootstrap.js';
import { registerCommands } from './discord/commands/register.js';
import { bindDiscordInteractionHandlers } from './discord/client.js';
import { createPermissionActionId, createPermissionActions } from './discord/interactions/permission-actions.js';
import { handleThreadMessage } from './discord/message-handler.js';
import { buildRuntimeErrorText } from './discord/ui/embeds.js';
import { createStreamingPreview } from './app/streaming.js';
import type { AttachmentRef } from './domain/last-turn.js';
import type { Project } from './domain/project.js';
import { buildPermissionStatusMessage } from './discord/ui/messages.js';

void (async () => {
  const app = await bootstrap();
  const permissionActions = createPermissionActions(app.orchestrator);

  bindDiscordInteractionHandlers(app.discord, {
    onInteractionCreate: async (interaction: any) => {
      if (interaction?.isButton?.()) {
        const handled = await permissionActions.handlePermission(interaction.customId);
        if (handled && interaction.reply) {
          await interaction.reply({ content: '已处理权限响应', ephemeral: true });
        }
        return;
      }

      if (interaction?.isChatInputCommand?.()) {
        if (interaction.commandName === 'project') {
          const subcommand = interaction.options?.getSubcommand?.();
          if (subcommand === 'status') {
            const project = await app.repos.projects.getByChannelId(interaction.channelId);
            await replyOnce(interaction, project
              ? `项目：${project.name}\n默认代理：${project.defaultAgent}\n目录：${project.currentWorkDir}`
              : '当前频道尚未配置为项目频道');
            return;
          }
        }

        if (interaction.commandName === 'session') {
          const subcommand = interaction.options?.getSubcommand?.();
          if (subcommand === 'new') {
            const project = await app.repos.projects.getByChannelId(interaction.channelId);
            if (!project) {
              await replyOnce(interaction, '当前频道不是项目频道，无法创建会话线程');
              return;
            }
            if (!interaction.channel?.threads?.create) {
              await replyOnce(interaction, '当前频道不支持创建线程');
              return;
            }
            const requestedTitle = `${project.defaultAgent}-${Date.now()}`;
            const thread = await interaction.channel.threads.create({
              name: requestedTitle,
              autoArchiveDuration: 1440,
              reason: 'cc-connect 会话创建',
            });
            await app.orchestrator.createConversationThread({
              project,
              agentKind: project.defaultAgent,
              ownerUserId: interaction.user?.id ?? 'unknown',
              createdFrom: 'command',
              threadId: thread.id,
              requestedTitle,
            });
            await replyOnce(interaction, `已创建线程：<#${thread.id}>`);
            return;
          }

          if (subcommand === 'status') {
            const record = await app.repos.threads.getByThreadId(interaction.channelId);
            if (!record) {
              await replyOnce(interaction, '当前线程未绑定会话');
              return;
            }
            const binding = await app.repos.bindings.getByThreadRecordId(record.id);
            const runtimeState = await app.repos.runtimeStates.getByThreadRecordId(record.id);
            await replyOnce(
              interaction,
              [
                `线程：${record.threadTitle}`,
                `代理：${record.agentKind}`,
                `会话ID：${binding?.agentSessionId || '未建立'}`,
                `进程状态：${binding?.processState || 'unknown'}`,
                `忙碌：${runtimeState?.isBusy ? '是' : '否'}`,
                `错误：${runtimeState?.lastError || '无'}`,
              ].join('\n'),
            );
            return;
          }

          if (subcommand === 'cancel') {
            const record = await app.repos.threads.getByThreadId(interaction.channelId);
            if (!record) {
              await replyOnce(interaction, '当前线程未绑定会话');
              return;
            }
            await permissionActions.cancelThread(record.id);
            await replyOnce(interaction, '已发送取消请求');
            return;
          }

          if (subcommand === 'list') {
            const project = await resolveProjectForChannel(app, interaction.channelId);
            if (!project) {
              await replyOnce(interaction, '当前频道不是项目频道，也不属于已知项目线程');
              return;
            }
            const threads = await app.repos.threads.listByProjectId(project.id);
            const text = threads.length === 0
              ? '当前项目还没有会话线程'
              : threads.map((thread) => `- ${thread.threadTitle} (${thread.status})`).join('\n');
            await replyOnce(interaction, text);
            return;
          }

          if (subcommand === 'restart') {
            const record = await app.repos.threads.getByThreadId(interaction.channelId);
            if (!record) {
              await replyOnce(interaction, '当前线程未绑定会话');
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
            await replyOnce(interaction, '已重置会话绑定，下一轮消息会重新启动代理');
            return;
          }

          if (subcommand === 'retry') {
            const record = await app.repos.threads.getByThreadId(interaction.channelId);
            if (!record) {
              await replyOnce(interaction, '当前线程未绑定会话');
              return;
            }
            const project = await app.repos.projects.getById(record.projectId);
            if (!project) {
              await replyOnce(interaction, '找不到对应项目');
              return;
            }
            const lastTurn = app.sessions.getLastTurnSnapshot(record.id);
            if (!lastTurn) {
              await replyOnce(interaction, '当前线程没有可重试的上一轮输入');
              return;
            }
            if (!app.sessions.tryBeginTurn(record.id)) {
              await replyOnce(interaction, '当前线程正忙，请稍后重试');
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
              await replyOnce(interaction, '已重新发送上一轮输入');
            } catch (error) {
              app.sessions.finishTurn(record.id);
              throw error;
            }
            return;
          }
        }
      }
    },
  });

  app.discord.client.on('messageCreate', async (message: any) => {
    if (message?.author?.bot) {
      return;
    }
    const thread = await app.repos.threads.getByThreadId(message.channelId);
    if (!thread) {
      return;
    }
    const project = await app.repos.projects.getById(thread.projectId);
    if (!project) {
      return;
    }

    const { files, images } = await resolveMessageAttachments(message);
    try {
      let previewStarted = false;
      const preview = createStreamingPreview({
        create: async (content) => {
          const sent = await message.reply?.(content);
          const messageId = sent?.id ?? `${message.channelId}:${Date.now()}`;
          const runtimeState = await app.repos.runtimeStates.getByThreadRecordId(thread.id);
          if (runtimeState) {
            await app.repos.runtimeStates.upsert({
              ...runtimeState,
              lastPreviewMessageId: messageId,
              updatedAt: new Date().toISOString(),
            });
          }
          return {
            messageId,
            content,
          };
        },
        update: async (messageId, content) => {
          const existing = await message.channel?.messages?.fetch?.(messageId).catch(() => null);
          await existing?.edit?.(content);
        },
        throttleMs: 0,
      });

      const result = await handleThreadMessage({
        threadId: message.channelId,
        text: message.content ?? '',
        project,
        workDir: project.currentWorkDir || project.baseWorkDir,
        files,
        images,
        threadsRepo: app.repos.threads,
        bindingsRepo: app.repos.bindings,
        agents: app.agents,
        sessions: app.sessions,
        eventPump: app.eventPump,
        onRuntimeEvent: async (threadRecordId, event) => {
          if (!previewStarted) {
            await preview.start('处理中');
            previewStarted = true;
          }

          if (event.kind === 'permission_request') {
            await message.channel?.send?.({
              content: buildPermissionStatusMessage(event.toolName),
              components: [
                new ActionRowBuilder<ButtonBuilder>().addComponents(
                  new ButtonBuilder()
                    .setCustomId(createPermissionActionId({
                      threadRecordId,
                      requestId: event.requestId,
                      decision: 'approved',
                    }))
                    .setLabel('允许')
                    .setStyle(ButtonStyle.Success),
                  new ButtonBuilder()
                    .setCustomId(createPermissionActionId({
                      threadRecordId,
                      requestId: event.requestId,
                      decision: 'denied',
                    }))
                    .setLabel('拒绝')
                    .setStyle(ButtonStyle.Danger),
                ),
              ],
            });
          }

          await preview.applyEvent(event);
        },
      });

      if (!result.accepted && result.reason) {
        await message.reply?.(result.reason);
      }
    } catch (error) {
      await message.reply?.(buildRuntimeErrorText(error instanceof Error ? error.message : 'unknown error'));
    }
  });

  await registerCommands(app.discord, { publish: true });
  await app.discord.client.login(app.config.discordToken);
  app.logger.info('discord client logged in', {
    guildId: app.config.discordGuildId,
  });
})();

async function replyOnce(interaction: any, content: string): Promise<void> {
  if (interaction?.replied || interaction?.deferred) {
    await interaction.followUp?.({ content, ephemeral: true });
    return;
  }
  await interaction.reply?.({ content, ephemeral: true });
}

async function resolveMessageAttachments(message: any): Promise<{
  files: Array<{ fileName: string; data: Uint8Array }>;
  images: Array<{ fileName: string; data: Uint8Array; mimeType: string }>;
}> {
  const files: Array<{ fileName: string; data: Uint8Array }> = [];
  const images: Array<{ fileName: string; data: Uint8Array; mimeType: string }> = [];

  const attachments = Array.from(message.attachments?.values?.() ?? []) as Array<{
    url?: string;
    name?: string;
    contentType?: string | null;
  }>;
  for (const attachment of attachments) {
    if (!attachment.url || !attachment.name) {
      continue;
    }
    const response = await fetch(attachment.url);
    const data = new Uint8Array(await response.arrayBuffer());
    if (String(attachment.contentType || '').startsWith('image/')) {
      images.push({
        fileName: attachment.name,
        data,
        mimeType: attachment.contentType || 'image/png',
      });
    } else {
      files.push({
        fileName: attachment.name,
        data,
      });
    }
  }

  return { files, images };
}

async function resolveProjectForChannel(app: Awaited<ReturnType<typeof bootstrap>>, channelId: string): Promise<Project | null> {
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
