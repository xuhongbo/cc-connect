import { describe, expect, it, vi } from 'vitest';

import { createOrchestrator } from '../src/app/orchestrator.js';
import { createSessionManager } from '../src/sessions/session-manager.js';
import type { AgentSessionRuntime } from '../src/agents/types.js';
import { NoopSessionRuntime } from '../src/agents/base/cli-agent.js';
import { createPermissionRequestEvent } from '../src/agents/events.js';
import { createRuntimeEventPump } from '../src/app/runtime-event-pump.js';

class PermissionRuntime extends NoopSessionRuntime implements AgentSessionRuntime {
  respondPermission = vi.fn(async () => {});
  cancel = vi.fn(async () => {});
  async *events() {
    yield createPermissionRequestEvent({
      requestId: 'req-1',
      toolName: 'Bash',
      toolInput: { command: 'ls' },
    });
  }
}

describe('claude permission roundtrip', () => {
  it('routes permission responses to the bound runtime', async () => {
    const runtime = new PermissionRuntime();
    const sessions = createSessionManager();
    sessions.setRuntime('thread-1', runtime);

    const orchestrator = createOrchestrator({
      threadsRepo: { async upsert() {} },
      bindingsRepo: {
        async upsert() {},
        async getByThreadRecordId() { return null; },
      },
      runtimeStateRepo: {
        async upsert() {},
        async getByThreadRecordId() { return null; },
      },
      sessions,
    });

    await orchestrator.respondPermission('thread-1', {
      requestId: 'req-1',
      decision: 'approved',
    });

    expect(runtime.respondPermission).toHaveBeenCalledWith({
      requestId: 'req-1',
      decision: 'approved',
    });
  });
});

describe('session cancel routing', () => {
  it('routes cancel requests to the bound runtime', async () => {
    const runtime = new PermissionRuntime();
    const sessions = createSessionManager();
    sessions.setRuntime('thread-2', runtime);

    const orchestrator = createOrchestrator({
      threadsRepo: { async upsert() {} },
      bindingsRepo: {
        async upsert() {},
        async getByThreadRecordId() { return null; },
      },
      runtimeStateRepo: {
        async upsert() {},
        async getByThreadRecordId() { return null; },
      },
      sessions,
    });

    await orchestrator.cancelThread('thread-2', 'user_cancelled');
    expect(runtime.cancel).toHaveBeenCalledWith('user_cancelled');
  });

  it('runtime event pump can surface permission requests to hooks', async () => {
    const runtime = new PermissionRuntime();
    const sessions = createSessionManager();
    const onEvent = vi.fn();
    const pump = createRuntimeEventPump(sessions, { onEvent });

    await pump.ensurePump('thread-3', runtime);

    expect(onEvent).toHaveBeenCalledWith('thread-3', expect.objectContaining({
      kind: 'permission_request',
      requestId: 'req-1',
    }));
  });
});
