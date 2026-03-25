import type { Project } from '../domain/project.js';
import type { AgentKind } from '../domain/project.js';
import type { ThreadCreatedFrom } from '../domain/thread.js';
import type { ConversationThread } from '../domain/thread.js';
import type { AgentSessionBinding } from '../domain/session-binding.js';
import type { RuntimeState } from '../domain/runtime-state.js';
import { createThreadBundle } from '../discord/threads/create-thread.js';

export interface SessionCommandResolution {
  project: Project;
}

interface ThreadsRepoLike {
  upsert(thread: ConversationThread): Promise<void>;
}

interface BindingsRepoLike {
  upsert(binding: AgentSessionBinding): Promise<void>;
}

interface RuntimeStateRepoLike {
  upsert(state: RuntimeState): Promise<void>;
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
  };
}

export type Orchestrator = ReturnType<typeof createOrchestrator>;
