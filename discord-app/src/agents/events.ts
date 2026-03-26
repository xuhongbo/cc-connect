export type AgentRuntimeEventKind =
  | 'session_init'
  | 'turn_started'
  | 'text_delta'
  | 'text_final'
  | 'thinking'
  | 'tool_use'
  | 'tool_result'
  | 'permission_request'
  | 'permission_resolved'
  | 'turn_completed'
  | 'turn_failed'
  | 'runtime_error';

type Timestamped = {
  timestamp: string;
};

interface AgentRuntimeEventBase extends Timestamped {
  kind: AgentRuntimeEventKind;
  raw?: unknown;
}

export type AgentRuntimeTurnFailureKind =
  | 'recoverable_turn_failure'
  | 'session_id_invalid'
  | 'user_denied'
  | 'user_cancelled';

export type AgentRuntimeRuntimeFailureKind = 'runtime_broken' | 'transient_warning';

export type PermissionResolutionDecision = 'approved' | 'denied' | 'cancelled' | 'timed_out';

export interface SessionInitEvent extends AgentRuntimeEventBase {
  kind: 'session_init';
  sessionId: string;
}

export interface TurnStartedEvent extends AgentRuntimeEventBase {
  kind: 'turn_started';
  sessionId?: string;
}

export interface TextDeltaEvent extends AgentRuntimeEventBase {
  kind: 'text_delta';
  content: string;
}

export interface TextFinalEvent extends AgentRuntimeEventBase {
  kind: 'text_final';
  content: string;
}

export interface ThinkingEvent extends AgentRuntimeEventBase {
  kind: 'thinking';
  content: string;
}

export interface ToolUseEvent extends AgentRuntimeEventBase {
  kind: 'tool_use';
  toolName: string;
  toolCallId?: string;
  toolInput?: unknown;
  sessionId?: string;
  requestId?: string;
}

export interface ToolResultEvent extends AgentRuntimeEventBase {
  kind: 'tool_result';
  isError?: boolean;
  toolName?: string;
  toolCallId?: string;
  content?: string;
  sessionId?: string;
}

export interface PermissionRequestEvent extends AgentRuntimeEventBase {
  kind: 'permission_request';
  requestId: string;
  toolName: string;
  toolInput?: unknown;
  toolCallId?: string;
}

export interface PermissionResolvedEvent extends AgentRuntimeEventBase {
  kind: 'permission_resolved';
  requestId: string;
  decision: PermissionResolutionDecision;
}

export interface TurnCompletedEvent extends AgentRuntimeEventBase {
  kind: 'turn_completed';
  sessionId?: string;
  usage?: unknown;
}

export interface TurnFailedEvent extends AgentRuntimeEventBase {
  kind: 'turn_failed';
  message: string;
  failureKind: AgentRuntimeTurnFailureKind;
}

export interface RuntimeErrorEvent extends AgentRuntimeEventBase {
  kind: 'runtime_error';
  message: string;
  runtimeFailureKind: AgentRuntimeRuntimeFailureKind;
}

export type AgentRuntimeEvent =
  | SessionInitEvent
  | TurnStartedEvent
  | TextDeltaEvent
  | TextFinalEvent
  | ThinkingEvent
  | ToolUseEvent
  | ToolResultEvent
  | PermissionRequestEvent
  | PermissionResolvedEvent
  | TurnCompletedEvent
  | TurnFailedEvent
  | RuntimeErrorEvent;

function ensureTimestamp(timestamp?: string): string {
  return timestamp ?? new Date().toISOString();
}

function buildEvent<T extends AgentRuntimeEventBase>(
  kind: T['kind'],
  input: Omit<T, 'kind' | 'timestamp'> & { timestamp?: string },
): T {
  const { timestamp, ...payload } = input;
  return {
    kind,
    timestamp: ensureTimestamp(timestamp),
    ...payload,
  } as T;
}

export function createSessionInitEvent(input: Omit<SessionInitEvent, 'kind' | 'timestamp'> & { timestamp?: string }): SessionInitEvent {
  return buildEvent('session_init', input);
}

export function createTurnStartedEvent(input: Omit<TurnStartedEvent, 'kind' | 'timestamp'> & { timestamp?: string } = {}):
  TurnStartedEvent {
  return buildEvent('turn_started', input);
}

export function createTextDeltaEvent(input: Omit<TextDeltaEvent, 'kind' | 'timestamp'> & { timestamp?: string }): TextDeltaEvent {
  return buildEvent('text_delta', input);
}

export function createTextFinalEvent(input: Omit<TextFinalEvent, 'kind' | 'timestamp'> & { timestamp?: string }): TextFinalEvent {
  return buildEvent('text_final', input);
}

export function createThinkingEvent(input: Omit<ThinkingEvent, 'kind' | 'timestamp'> & { timestamp?: string }): ThinkingEvent {
  return buildEvent('thinking', input);
}

export function createToolUseEvent(input: Omit<ToolUseEvent, 'kind' | 'timestamp'> & { timestamp?: string }): ToolUseEvent {
  return buildEvent('tool_use', input);
}

export function createToolResultEvent(input: Omit<ToolResultEvent, 'kind' | 'timestamp'> & { timestamp?: string }): ToolResultEvent {
  return buildEvent('tool_result', input);
}

export function createPermissionRequestEvent(
  input: Omit<PermissionRequestEvent, 'kind' | 'timestamp'> & { timestamp?: string },
): PermissionRequestEvent {
  return buildEvent('permission_request', input);
}

export function createPermissionResolvedEvent(
  input: Omit<PermissionResolvedEvent, 'kind' | 'timestamp'> & { timestamp?: string },
): PermissionResolvedEvent {
  return buildEvent('permission_resolved', input);
}

export function createTurnCompletedEvent(
  input: Omit<TurnCompletedEvent, 'kind' | 'timestamp'> & { timestamp?: string } = {},
): TurnCompletedEvent {
  return buildEvent('turn_completed', input);
}

export function createTurnFailedEvent(
  input: Omit<TurnFailedEvent, 'kind' | 'timestamp'> & { timestamp?: string },
): TurnFailedEvent {
  return buildEvent('turn_failed', input);
}

export function createRuntimeErrorEvent(
  input: Omit<RuntimeErrorEvent, 'kind' | 'timestamp'> & { timestamp?: string },
): RuntimeErrorEvent {
  return buildEvent('runtime_error', input);
}
