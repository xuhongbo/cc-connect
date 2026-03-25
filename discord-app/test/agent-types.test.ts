import { describe, expect, it } from 'vitest';

import {
  createSessionInitEvent,
  createTextDeltaEvent,
  type AgentRuntimeEvent,
  type AgentRuntimeEventKind,
} from '../src/agents/events.js';
import { createAgentsManager } from '../src/agents/manager.js';
import type { AgentAdapter, PermissionResponseInput } from '../src/agents/types.js';

const emptyEvents = async function* (): AsyncIterable<AgentRuntimeEvent> {
  return;
};

describe('agent runtime interfaces', () => {
  it('creates structured runtime events', () => {
    const init = createSessionInitEvent({ sessionId: 'session', timestamp: '2026-03-25T00:00:00Z' });
    const delta = createTextDeltaEvent({ content: 'delta', timestamp: '2026-03-25T00:00:00Z' });

    expect(init.kind).toBe('session_init');
    expect(delta.content).toBe('delta');
    expect(delta.kind).toBe('text_delta');
  });

  it('registers and retrieves adapters by agent kind', () => {
    const manager = createAgentsManager();
    const adapter: AgentAdapter = {
      kind: 'claude',
      runtimeKind: 'persistent',
      createSession: async () => ({
        send: async () => {},
        cancel: async () => {},
        close: async () => {},
        isBusy: () => false,
        isAlive: () => true,
        getSessionId: () => '',
        respondPermission: async (_input: PermissionResponseInput) => {},
        getPendingPermission: () => null,
        events: emptyEvents,
      }),
      detectAvailability: async () => true,
    };

    manager.register(adapter);

    expect(manager.get('claude')).toBe(adapter);
    expect(manager.listKinds()).toEqual(['claude']);
  });
});
