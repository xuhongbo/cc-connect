import type { Project } from '../domain/project.js';
import type { AgentKind } from '../domain/project.js';
import type { ThreadCreatedFrom } from '../domain/thread.js';
import type { ConversationThread } from '../domain/thread.js';
import type { AgentSessionBinding } from '../domain/session-binding.js';
import type { ProcessState } from '../domain/session-binding.js';
import type { RuntimeState } from '../domain/runtime-state.js';
import type { AgentRuntimeEvent, AgentRuntimeRuntimeFailureKind } from '../agents/events.js';
import type { AgentSessionRuntime, PermissionResponseInput } from '../agents/types.js';
import { createThreadBundle } from '../discord/threads/create-thread.js';

export interface SessionCommandResolution {
  project: Project;
}

interface ThreadsRepoLike {
  upsert(thread: ConversationThread): Promise<void>;
}

interface BindingsRepoLike {
  upsert(binding: AgentSessionBinding): Promise<void>;
  getByThreadRecordId(threadRecordId: string): Promise<AgentSessionBinding | null>;
}

interface RuntimeStateRepoLike {
  upsert(state: RuntimeState): Promise<void>;
  getByThreadRecordId(threadRecordId: string): Promise<RuntimeState | null>;
}

export interface CreateConversationThreadInput {
  project: Project;
  agentKind: AgentKind;
  ownerUserId: string;
  createdFrom: ThreadCreatedFrom;
  threadId: string;
  requestedTitle: string;
}

export function createOrchestrator(deps: {
  threadsRepo: ThreadsRepoLike;
  bindingsRepo: BindingsRepoLike;
  runtimeStateRepo: RuntimeStateRepoLike;
  sessions?: {
    getRuntime(threadRecordId: string): AgentSessionRuntime | null;
  };
}) {
  return {
    async beginSessionCreation(resolution: SessionCommandResolution): Promise<SessionCommandResolution> {
      return resolution;
    },
    async createConversationThread(input: CreateConversationThreadInput) {
      const bundle = createThreadBundle(input);
      await deps.threadsRepo.upsert(bundle.thread);
      await deps.bindingsRepo.upsert(bundle.binding);
      await deps.runtimeStateRepo.upsert(bundle.runtimeState);
      return bundle;
    },
    async syncRuntimeEvent(threadRecordId: string, event: AgentRuntimeEvent): Promise<void> {
      const binding = await deps.bindingsRepo.getByThreadRecordId(threadRecordId);
      const state = (await deps.runtimeStateRepo.getByThreadRecordId(threadRecordId)) ?? {
        threadRecordId,
        isBusy: false,
        lastMessageId: '',
        lastPreviewMessageId: '',
        lastError: '',
        queuedMessageCount: 0,
        updatedAt: new Date().toISOString(),
      };

      if (binding) {
        const nextBinding = { ...binding };
        let shouldWriteBinding = false;
        if (event.kind === 'session_init' && event.sessionId) {
          nextBinding.agentSessionId = event.sessionId;
          nextBinding.lastSeenAt = event.timestamp;
          nextBinding.processState = 'running';
          shouldWriteBinding = true;
        } else if (event.kind === 'turn_started') {
          nextBinding.processState = 'running';
          nextBinding.lastSeenAt = event.timestamp;
          shouldWriteBinding = true;
        } else if (event.kind === 'turn_completed') {
          nextBinding.processState = 'idle';
          nextBinding.lastSeenAt = event.timestamp;
          shouldWriteBinding = true;
        } else if (event.kind === 'turn_failed') {
          nextBinding.processState = 'idle';
          nextBinding.lastSeenAt = event.timestamp;
          if (event.failureKind === 'session_id_invalid') {
            nextBinding.agentSessionId = '';
          }
          shouldWriteBinding = true;
        } else if (event.kind === 'runtime_error') {
          nextBinding.processState = nextProcessStateForRuntimeError(event.runtimeFailureKind);
          nextBinding.lastSeenAt = event.timestamp;
          shouldWriteBinding = true;
        }

        if (shouldWriteBinding) {
          nextBinding.updatedAt = new Date().toISOString();
          await deps.bindingsRepo.upsert(nextBinding);
        }
      }

      let nextState = { ...state, updatedAt: new Date().toISOString() };
      if (event.kind === 'turn_started') {
        nextState = {
          ...nextState,
          isBusy: true,
          lastError: '',
        };
      } else if (event.kind === 'turn_completed') {
        nextState = {
          ...nextState,
          isBusy: false,
          lastError: '',
        };
      } else if (event.kind === 'turn_failed') {
        nextState = {
          ...nextState,
          isBusy: false,
          lastError: event.message,
        };
      } else if (event.kind === 'runtime_error') {
        nextState = {
          ...nextState,
          isBusy: false,
          lastError: event.message,
        };
      }

      await deps.runtimeStateRepo.upsert(nextState);
    },
    async respondPermission(threadRecordId: string, input: PermissionResponseInput): Promise<void> {
      const runtime = deps.sessions?.getRuntime(threadRecordId);
      if (!runtime) {
        throw new Error(`No runtime found for thread ${threadRecordId}`);
      }
      await runtime.respondPermission(input);
    },
    async cancelThread(threadRecordId: string, reason = 'user_cancelled'): Promise<void> {
      const runtime = deps.sessions?.getRuntime(threadRecordId);
      if (!runtime) {
        throw new Error(`No runtime found for thread ${threadRecordId}`);
      }
      await runtime.cancel(reason);
    },
  };
}

export type Orchestrator = ReturnType<typeof createOrchestrator>;

function nextProcessStateForRuntimeError(_kind: AgentRuntimeRuntimeFailureKind): ProcessState {
  return 'broken';
}
