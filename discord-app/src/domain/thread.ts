import type { AgentKind } from './project.js';

export type ThreadStatus = 'idle' | 'active' | 'error' | 'archived' | 'interrupted';
export type ThreadCreatedFrom = 'command' | 'message' | 'panel';

export interface ConversationThread {
  id: string;
  projectId: string;
  guildId: string;
  parentChannelId: string;
  threadId: string;
  threadTitle: string;
  threadPrefix: string;
  agentKind: AgentKind;
  status: ThreadStatus;
  discordTagIds: string[];
  ownerUserId: string;
  createdFrom: ThreadCreatedFrom;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface CreateConversationThreadInput {
  id: string;
  projectId: string;
  guildId: string;
  parentChannelId: string;
  threadId: string;
  threadTitle: string;
  threadPrefix: string;
  agentKind: AgentKind;
  ownerUserId: string;
  createdFrom: ThreadCreatedFrom;
  status?: ThreadStatus;
  discordTagIds?: string[];
}

export function createConversationThread(input: CreateConversationThreadInput): ConversationThread {
  const now = new Date().toISOString();
  return {
    id: input.id,
    projectId: input.projectId,
    guildId: input.guildId,
    parentChannelId: input.parentChannelId,
    threadId: input.threadId,
    threadTitle: input.threadTitle,
    threadPrefix: input.threadPrefix,
    agentKind: input.agentKind,
    status: input.status ?? 'idle',
    discordTagIds: input.discordTagIds ?? [],
    ownerUserId: input.ownerUserId,
    createdFrom: input.createdFrom,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
}
