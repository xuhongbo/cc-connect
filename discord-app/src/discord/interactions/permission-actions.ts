import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import type { Orchestrator } from '../../app/orchestrator.js';
import type { PermissionResponseDecision } from '../../agents/types.js';

export type PermissionActionKind = 'approve' | 'deny';

export interface PermissionAction {
  threadRecordId: string;
  requestId: string;
  decision: PermissionResponseDecision;
}

export type PermissionInteractionResult =
  | { status: 'handled'; action: PermissionAction }
  | { status: 'already_handled'; action: PermissionAction }
  | { status: 'invalid'; customId: string }
  | { status: 'failed'; action: PermissionAction; error: Error };

export type PermissionCancelResult =
  | { status: 'cancelled'; threadRecordId: string }
  | { status: 'missing_runtime'; threadRecordId: string }
  | { status: 'error'; threadRecordId: string; error: Error };

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

export function buildPermissionActionRow(
  threadRecordId: string,
  requestId: string,
  options: { disabled?: boolean } = {},
) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(createPermissionActionId({
        threadRecordId,
        requestId,
        decision: 'approved',
      }))
      .setLabel('允许')
      .setStyle(ButtonStyle.Success)
      .setDisabled(Boolean(options.disabled)),
    new ButtonBuilder()
      .setCustomId(createPermissionActionId({
        threadRecordId,
        requestId,
        decision: 'denied',
      }))
      .setLabel('拒绝')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(Boolean(options.disabled)),
  );
}

export function buildPermissionResolvedText(toolName: string, decision: PermissionResponseDecision): string {
  const decisionLabel = decision === 'approved' ? '批准' : '拒绝';
  return `权限响应已处理（${decisionLabel}）：${toolName}`;
}

export function createPermissionActions(orchestrator: Pick<Orchestrator, 'respondPermission' | 'cancelThread'>) {
  const handledPermissions = new Set<string>();

  const normalizeError = (value: unknown): Error => {
    if (value instanceof Error) {
      return value;
    }
    return new Error(typeof value === 'string' ? value : 'unknown error');
  };

  const resolveActionKey = (action: PermissionAction) => `${action.threadRecordId}:${action.requestId}`;

  async function processPermissionResult(customId: string): Promise<PermissionInteractionResult> {
    const action = parsePermissionActionId(customId);
    if (!action) {
      return { status: 'invalid', customId };
    }
    const key = resolveActionKey(action);
    if (handledPermissions.has(key)) {
      return { status: 'already_handled', action };
    }
    try {
      await orchestrator.respondPermission(action.threadRecordId, {
        requestId: action.requestId,
        decision: action.decision,
      });
      handledPermissions.add(key);
      return { status: 'handled', action };
    } catch (error) {
      return {
        status: 'failed',
        action,
        error: normalizeError(error),
      };
    }
  }

  async function processCancel(threadRecordId: string): Promise<PermissionCancelResult> {
    try {
      await orchestrator.cancelThread(threadRecordId, 'user_cancelled');
      return { status: 'cancelled', threadRecordId };
    } catch (error) {
      const normalized = normalizeError(error);
      if (normalized.message.includes('No runtime found for thread')) {
        return { status: 'missing_runtime', threadRecordId };
      }
      return { status: 'error', threadRecordId, error: normalized };
    }
  }

  return {
    async handlePermission(customId: string): Promise<PermissionAction | null> {
      const result = await processPermissionResult(customId);
      if (result.status === 'handled' || result.status === 'already_handled') {
        return result.action;
      }
      return null;
    },
    async handlePermissionResult(customId: string): Promise<PermissionInteractionResult> {
      return processPermissionResult(customId);
    },
    async cancelThread(threadRecordId: string): Promise<void> {
      const result = await processCancel(threadRecordId);
      if (result.status === 'error') {
        throw result.error;
      }
    },
    async cancelThreadResult(threadRecordId: string): Promise<PermissionCancelResult> {
      return processCancel(threadRecordId);
    },
  };
}
