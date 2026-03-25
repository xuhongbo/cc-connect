import type { AgentKind } from './project.js';

export type RuntimeKind = 'persistent' | 'resume-per-turn';
export type ResumeStrategy = 'stdio' | 'resume-id' | 'continue-latest';
export type ProcessState = 'not_started' | 'running' | 'idle' | 'exited' | 'broken';

export interface AgentSessionBinding {
  id: string;
  threadRecordId: string;
  agentKind: AgentKind;
  agentSessionId: string;
  runtimeKind: RuntimeKind;
  resumeStrategy: ResumeStrategy;
  cliBin: string;
  model: string;
  mode: string;
  reasoningEffort: string;
  processState: ProcessState;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentSessionBindingInput {
  id: string;
  threadRecordId: string;
  agentKind: AgentKind;
  runtimeKind: RuntimeKind;
  resumeStrategy: ResumeStrategy;
  cliBin: string;
  model?: string;
  mode?: string;
  reasoningEffort?: string;
}

export function createAgentSessionBinding(input: CreateAgentSessionBindingInput): AgentSessionBinding {
  const now = new Date().toISOString();
  return {
    id: input.id,
    threadRecordId: input.threadRecordId,
    agentKind: input.agentKind,
    agentSessionId: '',
    runtimeKind: input.runtimeKind,
    resumeStrategy: input.resumeStrategy,
    cliBin: input.cliBin,
    model: input.model ?? '',
    mode: input.mode ?? '',
    reasoningEffort: input.reasoningEffort ?? '',
    processState: 'not_started',
    lastSeenAt: null,
    createdAt: now,
    updatedAt: now,
  };
}
