import type { Orchestrator } from '../../app/orchestrator.js';
import type { PermissionResponseDecision } from '../../agents/types.js';

export type PermissionActionKind = 'approve' | 'deny';

export interface PermissionAction {
  threadRecordId: string;
  requestId: string;
  decision: PermissionResponseDecision;
}

export function createPermissionActionId(action: PermissionAction): string {
  const kind: PermissionActionKind = action.decision === 'approved' ? 'approve' : 'deny';
  return `perm:${kind}:${action.threadRecordId}:${action.requestId}`;
}

export function parsePermissionActionId(customId: string): PermissionAction | null {
  const [prefix, kind, threadRecordId, requestId] = customId.split(':');
  if (prefix !== 'perm' || !threadRecordId || !requestId) {
    return null;
  }
  if (kind === 'approve') {
    return { threadRecordId, requestId, decision: 'approved' };
  }
  if (kind === 'deny') {
    return { threadRecordId, requestId, decision: 'denied' };
  }
  return null;
}

export function createPermissionActions(orchestrator: Pick<Orchestrator, 'respondPermission' | 'cancelThread'>) {
  return {
    async handlePermission(customId: string): Promise<boolean> {
      const action = parsePermissionActionId(customId);
      if (!action) {
        return false;
      }
      await orchestrator.respondPermission(action.threadRecordId, {
        requestId: action.requestId,
        decision: action.decision,
      });
      return true;
    },
    async cancelThread(threadRecordId: string): Promise<void> {
      await orchestrator.cancelThread(threadRecordId, 'user_cancelled');
    },
  };
}
