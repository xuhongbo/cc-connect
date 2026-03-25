export type AgentEventType = 'text' | 'thinking' | 'tool_use' | 'result' | 'error' | 'session_init';

export interface AgentEvent {
  type: AgentEventType;
  content?: string;
  toolName?: string;
  sessionId?: string;
  done?: boolean;
  raw?: unknown;
}

export function createAgentEvent(type: AgentEventType, patch: Omit<AgentEvent, 'type'> = {}): AgentEvent {
  return {
    type,
    ...patch,
  };
}
