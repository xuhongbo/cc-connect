import { createLastTurnSnapshot } from '../domain/last-turn.js';
import type { ConversationThread } from '../domain/thread.js';
import type { AgentSessionBinding } from '../domain/session-binding.js';
import type { AgentsManager } from '../agents/manager.js';
import type { SessionManager } from '../sessions/session-manager.js';
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
  workDir?: string;
  files?: InputFile[];
  images?: InputImage[];
  threadsRepo: ThreadsRepoLike;
  bindingsRepo: BindingsRepoLike;
  agents: AgentsManager;
  sessions: SessionManager;
}

export async function handleThreadMessage(input: HandleThreadMessageInput): Promise<{ accepted: boolean; reason?: string }> {
  const thread = await input.threadsRepo.getByThreadId(input.threadId);
  if (!thread) {
    return { accepted: false, reason: 'Unknown thread.' };
  }

  if (!input.sessions.tryBeginTurn(thread.id)) {
    return { accepted: false, reason: 'Thread is busy.' };
  }

  try {
    const binding = await input.bindingsRepo.getByThreadRecordId(thread.id);
    if (!binding) {
      return { accepted: false, reason: 'Thread has no bound agent session.' };
    }

    const adapter = input.agents.get(binding.agentKind);
    if (!adapter) {
      return { accepted: false, reason: `No adapter registered for ${binding.agentKind}.` };
    }

    const runtime = input.sessions.getRuntime(thread.id) ?? await adapter.createSession();
    input.sessions.setRuntime(thread.id, runtime);

    const staged = input.workDir
      ? await stageAttachments({
          workDir: input.workDir,
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

    await runtime.send({
      text: input.text,
      files: staged.files,
      images: staged.images,
    });
    return { accepted: true };
  } finally {
    input.sessions.finishTurn(thread.id);
  }
}
