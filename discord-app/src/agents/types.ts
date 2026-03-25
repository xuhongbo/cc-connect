import type { AgentKind } from '../domain/project.js';
import type { AgentSessionBinding } from '../domain/session-binding.js';
import type { LastTurnSnapshot } from '../domain/last-turn.js';
import type { AgentRuntimeEvent } from './events.js';

export type RuntimeKind = 'persistent' | 'resume-per-turn';

export interface RuntimeFileRef {
  name: string;
  path: string;
}

export interface RuntimeImageRef {
  name: string;
  path: string;
  mimeType: string;
}

export interface AgentRuntimeInput {
  text?: string;
  files?: RuntimeFileRef[];
  images?: RuntimeImageRef[];
}

export interface AgentRuntimeProjectContext {
  projectId: string;
  defaultAgent: AgentKind;
  defaultModel: string;
  defaultMode: string;
}

export interface CreateAgentSessionInput {
  workDir: string;
  binding: AgentSessionBinding;
  projectContext: AgentRuntimeProjectContext;
  lastTurn?: LastTurnSnapshot | null;
}

export type PermissionResponseDecision = 'approved' | 'denied';

export interface PermissionResponseInput {
  requestId: string;
  decision: PermissionResponseDecision;
  note?: string;
}

export interface PendingPermissionState {
  requestId: string;
  toolName: string;
  toolInput?: unknown;
  toolCallId?: string;
  requestedAt: string;
}

export interface AgentSessionRuntime {
  send(input: AgentRuntimeInput): Promise<void>;
  cancel(reason?: string): Promise<void>;
  close(): Promise<void>;
  isBusy(): boolean;
  isAlive(): boolean;
  getSessionId(): string;
  getPendingPermission(): PendingPermissionState | null;
  respondPermission(input: PermissionResponseInput): Promise<void>;
  events(): AsyncIterable<AgentRuntimeEvent>;
}

export interface AgentAdapter {
  kind: AgentKind;
  runtimeKind: RuntimeKind;
  createSession(input: CreateAgentSessionInput): Promise<AgentSessionRuntime>;
  detectAvailability(): Promise<boolean>;
}
