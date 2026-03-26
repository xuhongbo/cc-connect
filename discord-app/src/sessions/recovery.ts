import type { LastTurnSnapshot } from '../domain/last-turn.js';
import type { Project } from '../domain/project.js';
import type { RuntimeState } from '../domain/runtime-state.js';
import type { AgentSessionBinding } from '../domain/session-binding.js';
import type { ConversationThread } from '../domain/thread.js';
import type { StorageHandle } from '../storage/db.js';
import { createLastTurnRepo } from '../storage/repositories/last-turn-repo.js';
import { createProjectsRepo } from '../storage/repositories/projects-repo.js';
import { createRuntimeStateRepo } from '../storage/repositories/runtime-state-repo.js';
import { createSessionBindingsRepo } from '../storage/repositories/session-bindings-repo.js';
import { createThreadsRepo } from '../storage/repositories/threads-repo.js';

export interface RecoveryMarker {
  threadRecordId: string;
  state: 'interrupted';
}

export interface StartupRecoveryState {
  projects: Project[];
  threads: ConversationThread[];
  bindings: AgentSessionBinding[];
  runtimeStates: RuntimeState[];
  lastTurns: LastTurnSnapshot[];
  interruptedThreadRecordIds: string[];
}

export function markInterrupted(threadRecordId: string): RecoveryMarker {
  return {
    threadRecordId,
    state: 'interrupted',
  };
}

export async function restoreStartupState(input: { storage: StorageHandle }): Promise<StartupRecoveryState> {
  const projectsRepo = createProjectsRepo(input.storage);
  const threadsRepo = createThreadsRepo(input.storage);
  const bindingsRepo = createSessionBindingsRepo(input.storage);
  const runtimeStateRepo = createRuntimeStateRepo(input.storage);
  const lastTurnRepo = createLastTurnRepo(input.storage);

  const projects = await projectsRepo.list();
  const bindings = await bindingsRepo.list();
  const lastTurns = await lastTurnRepo.list();
  const busyThreadIds = new Set(
    (await runtimeStateRepo.list())
      .filter((state) => state.isBusy)
      .map((state) => state.threadRecordId),
  );

  const interruptedThreadRecordIds = Array.from(busyThreadIds);

  const threads = await Promise.all(
    (await threadsRepo.list()).map(async (thread) => {
      if (!busyThreadIds.has(thread.id)) {
        return thread;
      }

      const next: ConversationThread = {
        ...thread,
        status: 'interrupted',
        updatedAt: new Date().toISOString(),
      };
      await threadsRepo.upsert(next);
      return next;
    }),
  );

  const runtimeStates = await Promise.all(
    (await runtimeStateRepo.list()).map(async (state) => {
      if (!busyThreadIds.has(state.threadRecordId)) {
        return state;
      }

      const next: RuntimeState = {
        ...state,
        isBusy: false,
        queuedMessageCount: 0,
        lastError: 'Interrupted during restart.',
        updatedAt: new Date().toISOString(),
      };
      await runtimeStateRepo.upsert(next);
      return next;
    }),
  );

  return {
    projects,
    threads,
    bindings,
    runtimeStates,
    lastTurns,
    interruptedThreadRecordIds,
  };
}
