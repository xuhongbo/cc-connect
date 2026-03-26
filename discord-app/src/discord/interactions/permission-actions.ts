import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
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
  return decision === 'approved'
    ? `权限已批准：${toolName}`
    : `权限已拒绝：${toolName}`;
}

export function createPermissionActions(orchestrator: Pick<Orchestrator, 'respondPermission' | 'cancelThread'>) {
  return {
    async handlePermission(customId: string): Promise<PermissionAction | null> {
      const action = parsePermissionActionId(customId);
      if (!action) {
        return null;
      }
      await orchestrator.respondPermission(action.threadRecordId, {
        requestId: action.requestId,
        decision: action.decision,
      });
      return action;
    },
    async cancelThread(threadRecordId: string): Promise<void> {
      await orchestrator.cancelThread(threadRecordId, 'user_cancelled');
    },
  };
}
