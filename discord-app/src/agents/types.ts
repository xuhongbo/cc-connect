import type { AgentKind } from '../domain/project.js';

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
  text: string;
  files?: RuntimeFileRef[];
  images?: RuntimeImageRef[];
}

export interface AgentSessionRuntime {
  send(input: AgentRuntimeInput): Promise<void>;
  cancel(): Promise<void>;
  close(): Promise<void>;
  isBusy(): boolean;
  isAlive(): boolean;
  getSessionId(): string;
  events(): AsyncIterable<unknown> | unknown[];
}

export interface AgentAdapter {
  kind: AgentKind;
  runtimeKind: RuntimeKind;
  createSession(): Promise<AgentSessionRuntime>;
  detectAvailability(): Promise<boolean>;
}
