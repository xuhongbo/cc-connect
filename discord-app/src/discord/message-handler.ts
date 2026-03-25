import { createLastTurnSnapshot } from '../domain/last-turn.js';
import type { ConversationThread } from '../domain/thread.js';
import type { AgentSessionBinding } from '../domain/session-binding.js';
import type { Project } from '../domain/project.js';
import type { AgentRuntimeProjectContext } from '../agents/types.js';
import type { AgentsManager } from '../agents/manager.js';
import type { SessionManager } from '../sessions/session-manager.js';
import type { RuntimeEventPump } from '../app/runtime-event-pump.js';
import { stageAttachments } from '../utils/files.js';

interface ThreadsRepoLike {
  getByThreadId(threadId: string): Promise<ConversationThread | null>;
}

interface BindingsRepoLike {
  getByThreadRecordId(threadRecordId: string): Promise<AgentSessionBinding | null>;
}

interface InputFile {
  fileName: string;
  data: Uint8Array;
}

interface InputImage {
  fileName: string;
  data: Uint8Array;
  mimeType: string;
}

export interface HandleThreadMessageInput {
  threadId: string;
  text: string;
  project: Project;
  workDir?: string;
  files?: InputFile[];
  images?: InputImage[];
  threadsRepo: ThreadsRepoLike;
  bindingsRepo: BindingsRepoLike;
  agents: AgentsManager;
  sessions: SessionManager;
  eventPump: RuntimeEventPump;
}

export async function handleThreadMessage(input: HandleThreadMessageInput): Promise<{ accepted: boolean; reason?: string }> {
  const thread = await input.threadsRepo.getByThreadId(input.threadId);
  if (!thread) {
    return { accepted: false, reason: 'Unknown thread.' };
  }

  if (!input.sessions.tryBeginTurn(thread.id)) {
    return { accepted: false, reason: 'Thread is busy.' };
  }

  let pumpActivated = false;
  try {
    const binding = await input.bindingsRepo.getByThreadRecordId(thread.id);
    if (!binding) {
      input.sessions.finishTurn(thread.id);
      return { accepted: false, reason: 'Thread has no bound agent session.' };
    }

    const adapter = input.agents.get(binding.agentKind);
    if (!adapter) {
      input.sessions.finishTurn(thread.id);
      return { accepted: false, reason: `No adapter registered for ${binding.agentKind}.` };
    }

    const previousLastTurnSnapshot = input.sessions.getLastTurnSnapshot(thread.id);
    const workDir = input.workDir ?? input.project.currentWorkDir ?? input.project.baseWorkDir ?? '';
    const runtimeProjectContext: AgentRuntimeProjectContext = {
      projectId: input.project.id,
      defaultAgent: input.project.defaultAgent,
      defaultModel: input.project.defaultModel,
      defaultMode: input.project.defaultMode,
    };

    const runtime = input.sessions.getRuntime(thread.id) ?? await adapter.createSession({
      workDir,
      binding,
      projectContext: runtimeProjectContext,
      lastTurn: previousLastTurnSnapshot,
    });
    input.sessions.setRuntime(thread.id, runtime);

    const staged = workDir
      ? await stageAttachments({
          workDir,
          files: input.files ?? [],
          images: input.images ?? [],
        })
      : { files: [], images: [] };

    input.sessions.setLastTurnSnapshot(createLastTurnSnapshot({
      threadRecordId: thread.id,
      userMessageText: input.text,
      attachmentRefs: [
        ...staged.files.map((file) => ({ kind: 'file' as const, path: file.path, name: file.name })),
        ...staged.images.map((image) => ({ kind: 'image' as const, path: image.path, name: image.name })),
      ],
      agentKind: binding.agentKind,
      model: binding.model,
      mode: binding.mode,
    }));

    input.eventPump.ensurePump(thread.id, runtime);
    await runtime.send({
      text: input.text,
      files: staged.files,
      images: staged.images,
    });
    pumpActivated = true;
    return { accepted: true };
  } catch (err) {
    if (!pumpActivated) {
      input.sessions.finishTurn(thread.id);
    }
    throw err;
  }
}
