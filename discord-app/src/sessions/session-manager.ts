import type { LastTurnSnapshot } from '../domain/last-turn.js';
import { createThreadSessionMap } from './thread-session-map.js';
import type { AgentSessionRuntime } from '../agents/types.js';

export interface SessionManager {
  readonly kind: 'session-manager';
  tryBeginTurn(threadRecordId: string): boolean;
  finishTurn(threadRecordId: string): void;
  isBusy(threadRecordId: string): boolean;
  setLastTurnSnapshot(snapshot: LastTurnSnapshot): void;
  getLastTurnSnapshot(threadRecordId: string): LastTurnSnapshot | null;
  setRuntime(threadRecordId: string, runtime: AgentSessionRuntime): void;
  getRuntime(threadRecordId: string): AgentSessionRuntime | null;
}

export function createSessionManager(): SessionManager {
  const turnMap = createThreadSessionMap();
  const snapshots = new Map<string, LastTurnSnapshot>();
  const runtimes = new Map<string, AgentSessionRuntime>();

  return {
    kind: 'session-manager',
    tryBeginTurn(threadRecordId: string): boolean {
      return turnMap.tryBeginTurn(threadRecordId);
    },
    finishTurn(threadRecordId: string): void {
      turnMap.finishTurn(threadRecordId);
    },
    isBusy(threadRecordId: string): boolean {
      return turnMap.isBusy(threadRecordId);
    },
    setLastTurnSnapshot(snapshot: LastTurnSnapshot): void {
      snapshots.set(snapshot.threadRecordId, snapshot);
    },
    getLastTurnSnapshot(threadRecordId: string): LastTurnSnapshot | null {
      return snapshots.get(threadRecordId) ?? null;
    },
    setRuntime(threadRecordId: string, runtime: AgentSessionRuntime): void {
      runtimes.set(threadRecordId, runtime);
    },
    getRuntime(threadRecordId: string): AgentSessionRuntime | null {
      return runtimes.get(threadRecordId) ?? null;
    },
  };
}
