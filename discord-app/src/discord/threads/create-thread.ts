import { randomUUID } from 'node:crypto';
import type { AgentKind, Project } from '../../domain/project.js';
import { createConversationThread, type ConversationThread, type ThreadCreatedFrom } from '../../domain/thread.js';
import { createAgentSessionBinding, type AgentSessionBinding, type ResumeStrategy, type RuntimeKind } from '../../domain/session-binding.js';
import { createRuntimeState, type RuntimeState } from '../../domain/runtime-state.js';
import { buildThreadTitle, threadPrefixForAgent } from './naming.js';

export interface ThreadCreationInput {
  project: Project;
  agentKind: AgentKind;
  ownerUserId: string;
  createdFrom: ThreadCreatedFrom;
  threadId: string;
  requestedTitle: string;
}

export interface CreatedThreadBundle {
  thread: ConversationThread;
  binding: AgentSessionBinding;
  runtimeState: RuntimeState;
}

export function createThreadBundle(input: ThreadCreationInput): CreatedThreadBundle {
  const threadId = randomUUID();
  const thread = createConversationThread({
    id: threadId,
    projectId: input.project.id,
    guildId: input.project.guildId,
    parentChannelId: input.project.channelId,
    threadId: input.threadId,
    threadTitle: buildThreadTitle(input.agentKind, input.requestedTitle),
    threadPrefix: threadPrefixForAgent(input.agentKind),
    agentKind: input.agentKind,
    ownerUserId: input.ownerUserId,
    createdFrom: input.createdFrom,
  });

  const binding = createAgentSessionBinding({
    id: randomUUID(),
    threadRecordId: thread.id,
    agentKind: input.agentKind,
    runtimeKind: runtimeKindForAgent(input.agentKind),
    resumeStrategy: resumeStrategyForAgent(input.agentKind),
    cliBin: cliBinForAgent(input.agentKind),
    model: input.project.defaultModel,
    mode: input.project.defaultMode,
  });

  const runtimeState = createRuntimeState(thread.id);

  return { thread, binding, runtimeState };
}

function runtimeKindForAgent(agentKind: AgentKind): RuntimeKind {
  return agentKind === 'claude' ? 'persistent' : 'resume-per-turn';
}

function resumeStrategyForAgent(agentKind: AgentKind): ResumeStrategy {
  return agentKind === 'claude' ? 'stdio' : 'resume-id';
}

function cliBinForAgent(agentKind: AgentKind): string {
  switch (agentKind) {
    case 'claude':
      return 'claude';
    case 'codex':
      return 'codex';
    case 'gemini':
      return 'gemini';
  }
}
