import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

import { openStorage } from '../src/storage/db.js';
import { createSessionBindingsRepo } from '../src/storage/repositories/session-bindings-repo.js';
import { createRuntimeStateRepo } from '../src/storage/repositories/runtime-state-repo.js';
import { createAgentSessionBinding } from '../src/domain/session-binding.js';
import { createRuntimeState } from '../src/domain/runtime-state.js';
import { createSessionManager } from '../src/sessions/session-manager.js';
import { createRuntimeEventPump } from '../src/app/runtime-event-pump.js';
import { createOrchestrator } from '../src/app/orchestrator.js';
import { createSessionInitEvent, createTurnCompletedEvent, createTurnFailedEvent, createTurnStartedEvent, createRuntimeErrorEvent } from '../src/agents/events.js';
import { NoopSessionRuntime } from '../src/agents/base/cli-agent.js';
import type { AgentRuntimeEvent } from '../src/agents/events.js';

const cleanupDirs: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

class FakeRuntime extends NoopSessionRuntime {
  #events: AgentRuntimeEvent[];
  constructor(events: AgentRuntimeEvent[]) {
    super();
    this.#events = events;
  }
  async *events(): AsyncIterable<AgentRuntimeEvent> {
    for (const event of this.#events) {
      yield event;
    }
  }
}

describe('runtime state sync', () => {
  it('syncs binding sessionId and runtime busy/process state from events', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'discord-app-runtime-sync-'));
    cleanupDirs.push(dir);

    const storage = await openStorage({ dataDir: dir });
    const bindingsRepo = createSessionBindingsRepo(storage);
    const runtimeStateRepo = createRuntimeStateRepo(storage);
    const sessions = createSessionManager();

    const binding = createAgentSessionBinding({
      id: 'binding-1',
      threadRecordId: 'thread-1',
      agentKind: 'codex',
      runtimeKind: 'resume-per-turn',
      resumeStrategy: 'resume-id',
      cliBin: 'codex',
    });
    await bindingsRepo.upsert(binding);
    await runtimeStateRepo.upsert(createRuntimeState('thread-1'));

    const orchestrator = createOrchestrator({
      threadsRepo: { async upsert() {} },
      bindingsRepo,
      runtimeStateRepo,
    });
    const pump = createRuntimeEventPump(sessions, {
      onEvent: (threadRecordId, event) => orchestrator.syncRuntimeEvent(threadRecordId, event),
    });

    sessions.tryBeginTurn('thread-1');
    await pump.ensurePump('thread-1', new FakeRuntime([
      createSessionInitEvent({ sessionId: 'session-42' }),
      createTurnStartedEvent({ sessionId: 'session-42' }),
      createTurnCompletedEvent({ sessionId: 'session-42' }),
    ]));

    const nextBinding = await bindingsRepo.getByThreadRecordId('thread-1');
    const nextState = await runtimeStateRepo.getByThreadRecordId('thread-1');

    expect(nextBinding).toEqual(expect.objectContaining({
      agentSessionId: 'session-42',
      processState: 'idle',
    }));
    expect(nextState).toEqual(expect.objectContaining({
      isBusy: false,
      lastError: '',
    }));
    expect(sessions.isBusy('thread-1')).toBe(false);
  });

  it('marks runtime broken on runtime_error and clears invalid session ids on failure', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'discord-app-runtime-sync-'));
    cleanupDirs.push(dir);

    const storage = await openStorage({ dataDir: dir });
    const bindingsRepo = createSessionBindingsRepo(storage);
    const runtimeStateRepo = createRuntimeStateRepo(storage);
    const sessions = createSessionManager();

    const binding = createAgentSessionBinding({
      id: 'binding-2',
      threadRecordId: 'thread-2',
      agentKind: 'gemini',
      runtimeKind: 'resume-per-turn',
      resumeStrategy: 'resume-id',
      cliBin: 'gemini',
      model: 'gemini-pro',
    });
    binding.agentSessionId = 'chat-old';
    await bindingsRepo.upsert(binding);
    await runtimeStateRepo.upsert(createRuntimeState('thread-2'));

    const orchestrator = createOrchestrator({
      threadsRepo: { async upsert() {} },
      bindingsRepo,
      runtimeStateRepo,
    });
    await orchestrator.syncRuntimeEvent('thread-2', createTurnStartedEvent({}));
    await orchestrator.syncRuntimeEvent(
      'thread-2',
      createTurnFailedEvent({ message: 'invalid chat', failureKind: 'session_id_invalid' }),
    );
    await orchestrator.syncRuntimeEvent(
      'thread-2',
      createRuntimeErrorEvent({ message: 'broken', runtimeFailureKind: 'runtime_broken' }),
    );

    const nextBinding = await bindingsRepo.getByThreadRecordId('thread-2');
    const nextState = await runtimeStateRepo.getByThreadRecordId('thread-2');

    expect(nextBinding).toEqual(expect.objectContaining({
      agentSessionId: '',
      processState: 'broken',
    }));
    expect(nextState).toEqual(expect.objectContaining({
      isBusy: false,
      lastError: 'broken',
    }));
  });
});
