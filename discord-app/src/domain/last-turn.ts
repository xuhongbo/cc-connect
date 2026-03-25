import type { AgentKind } from './project.js';

export interface AttachmentRef {
  kind: 'file' | 'image';
  path: string;
  name: string;
  originalName?: string;
}

export interface LastTurnSnapshot {
  threadRecordId: string;
  userMessageText: string;
  attachmentRefs: AttachmentRef[];
  sentAt: string;
  agentKind: AgentKind;
  model: string;
  mode: string;
}

export function createLastTurnSnapshot(input: Omit<LastTurnSnapshot, 'sentAt'> & { sentAt?: string }): LastTurnSnapshot {
  return {
    ...input,
    sentAt: input.sentAt ?? new Date().toISOString(),
  };
}
