import type { AgentSessionRuntime } from '../agents/types.js';
import type { AgentRuntimeEvent } from '../agents/events.js';
import type { SessionManager } from '../sessions/session-manager.js';

export interface RuntimeEventPump {
  ensurePump(
    threadRecordId: string,
    runtime: AgentSessionRuntime,
    onEvent?: (threadRecordId: string, event: AgentRuntimeEvent) => Promise<void> | void,
  ): Promise<void>;
}

const TERMINATING_EVENTS = new Set(['turn_completed', 'turn_failed', 'runtime_error'] as const);

type TerminatingEventKind = (typeof TERMINATING_EVENTS) extends Set<infer K> ? K : never;

export function createRuntimeEventPump(
  sessionManager: SessionManager,
  hooks?: {
    onEvent?: (threadRecordId: string, event: AgentRuntimeEvent) => Promise<void> | void;
  },
): RuntimeEventPump {
  const pumps = new Map<string, Promise<void>>();

  return {
    ensurePump(threadRecordId, runtime, onEvent) {
      const existing = pumps.get(threadRecordId);
      if (existing) {
        return existing;
      }

      const pump = (async () => {
        let finished = false;
        try {
          for await (const event of runtime.events()) {
            await hooks?.onEvent?.(threadRecordId, event);
            if (onEvent) {
              await onEvent(threadRecordId, event);
            }
            if (TERMINATING_EVENTS.has(event.kind as TerminatingEventKind)) {
              sessionManager.finishTurn(threadRecordId);
              finished = true;
              break;
            }
          }
        } finally {
          if (!finished) {
            sessionManager.finishTurn(threadRecordId);
          }
          pumps.delete(threadRecordId);
        }
      })();

      pump.catch(() => undefined);

      pumps.set(threadRecordId, pump);
      return pump;
    },
  };
}
