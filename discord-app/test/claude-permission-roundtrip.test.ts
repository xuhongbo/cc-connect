import { describe, expect, it, vi } from 'vitest';

import { createOrchestrator } from '../src/app/orchestrator.js';
import { createSessionManager } from '../src/sessions/session-manager.js';
import type { AgentSessionRuntime } from '../src/agents/types.js';
import { NoopSessionRuntime } from '../src/agents/base/cli-agent.js';
import { createPermissionRequestEvent } from '../src/agents/events.js';
import { createRuntimeEventPump } from '../src/app/runtime-event-pump.js';
import {
  buildPermissionActionRow,
  buildPermissionResolvedText,
  createPermissionActions,
  createPermissionActionId,
} from '../src/discord/interactions/permission-actions.js';

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

class ErroringPermissionRuntime extends PermissionRuntime {
  respondPermission = vi.fn(async () => {
    throw new Error('boom');
  });
}

function createTestOrchestrator(runtime: AgentSessionRuntime, threadId = 'thread-1') {
  const sessions = createSessionManager();
  sessions.setRuntime(threadId, runtime);

  return createOrchestrator({
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
}

describe('claude permission roundtrip', () => {
  it('routes permission responses to the bound runtime', async () => {
    const runtime = new PermissionRuntime();
    const orchestrator = createTestOrchestrator(runtime);
    const permissionActions = createPermissionActions(orchestrator);
    const customId = createPermissionActionId({
      threadRecordId: 'thread-1',
      requestId: 'req-1',
      decision: 'approved',
    });

    const action = await permissionActions.handlePermission(customId);
    expect(action).toEqual({
      threadRecordId: 'thread-1',
      requestId: 'req-1',
      decision: 'approved',
    });
    expect(runtime.respondPermission).toHaveBeenCalledWith({
      requestId: 'req-1',
      decision: 'approved',
    });
  });

  it('builds disabled action rows and resolved text for handled permissions', async () => {
    const row = buildPermissionActionRow('thread-1', 'req-1', { disabled: true });
    const buttons = row.components;
    expect(buttons).toHaveLength(2);
    expect(buttons[0].data.disabled).toBe(true);
    expect(buttons[1].data.disabled).toBe(true);
    expect(buildPermissionResolvedText('Bash', 'approved')).toBe('权限响应已处理（批准）：Bash');
    expect(buildPermissionResolvedText('Bash', 'denied')).toBe('权限响应已处理（拒绝）：Bash');
    expect(createPermissionActionId({
      threadRecordId: 'thread-1',
      requestId: 'req-1',
      decision: 'approved',
    })).toContain('perm:approve:thread-1:req-1');
  });

  it('marks repeated permission clicks as already handled', async () => {
    const runtime = new PermissionRuntime();
    const orchestrator = createTestOrchestrator(runtime);
    const permissionActions = createPermissionActions(orchestrator);
    const customId = createPermissionActionId({
      threadRecordId: 'thread-1',
      requestId: 'req-1',
      decision: 'approved',
    });

    const first = await permissionActions.handlePermissionResult(customId);
    expect(first.status).toBe('handled');
    expect(runtime.respondPermission).toHaveBeenCalledTimes(1);

    const second = await permissionActions.handlePermissionResult(customId);
    expect(second.status).toBe('already_handled');
    expect(runtime.respondPermission).toHaveBeenCalledTimes(1);
  });

  it('treats malformed customIds as invalid', async () => {
    const runtime = new PermissionRuntime();
    const orchestrator = createTestOrchestrator(runtime);
    const permissionActions = createPermissionActions(orchestrator);

    const result = await permissionActions.handlePermissionResult('perm:approve:missing');
    expect(result.status).toBe('invalid');
    if (result.status !== 'invalid') {
      throw new Error('expected invalid status');
    }
    expect(result.customId).toBe('perm:approve:missing');
    expect(runtime.respondPermission).not.toHaveBeenCalled();
  });

  it('surfaces runtime failures without marking permissions handled', async () => {
    const runtime = new ErroringPermissionRuntime();
    const orchestrator = createTestOrchestrator(runtime);
    const permissionActions = createPermissionActions(orchestrator);
    const customId = createPermissionActionId({
      threadRecordId: 'thread-1',
      requestId: 'req-1',
      decision: 'approved',
    });

    const result = await permissionActions.handlePermissionResult(customId);
    expect(result.status).toBe('failed');
    if (result.status !== 'failed') {
      throw new Error('expected failed status');
    }
    expect(result.error.message).toBe('boom');
    expect(result.action.requestId).toBe('req-1');
    expect(runtime.respondPermission).toHaveBeenCalledTimes(1);
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
