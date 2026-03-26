import type { PendingPermissionState, PermissionResponseInput } from '../types.js';
import type { PermissionResolutionDecision } from '../events.js';

const DEFAULT_PERMISSION_TIMEOUT_MS = 30_000;

type Clock = {
  now(): string;
};

export type ClaudePermissionStateName =
  | 'running'
  | 'awaiting_permission'
  | 'permission_resolved'
  | 'cancelled'
  | 'timed_out';

export interface ClaudePermissionResolution {
  requestId: string;
  decision: PermissionResolutionDecision;
  resolvedAt: string;
}

export interface ClaudePermissionStateOptions {
  timeoutMs?: number;
  clock?: Clock;
  onResolution?: (resolution: ClaudePermissionResolution) => void;
}

export class ClaudePermissionState {
  private state: ClaudePermissionStateName = 'running';
  private pending: PendingPermissionState | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly clock: Clock;
  private readonly timeoutMs: number;
  private readonly onResolution?: (resolution: ClaudePermissionResolution) => void;

  constructor(options?: ClaudePermissionStateOptions) {
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_PERMISSION_TIMEOUT_MS;
    this.clock = options?.clock ?? { now: () => new Date().toISOString() };
    this.onResolution = options?.onResolution;
  }

  startRequest(input: {
    requestId: string;
    toolName: string;
    toolInput?: unknown;
    toolCallId?: string;
    requestedAt?: string;
  }): PendingPermissionState | null {
    if (this.pending) {
      return null;
    }
    this.clearTimer();
    const requestedAt = input.requestedAt ?? this.clock.now();
    this.pending = {
      requestId: input.requestId,
      toolName: input.toolName,
      toolInput: input.toolInput,
      toolCallId: input.toolCallId,
      requestedAt,
    };
    this.state = 'awaiting_permission';
    this.timer = setTimeout(() => this.handleTimeout(), this.timeoutMs);
    return this.pending;
  }

  respond(input: PermissionResponseInput): ClaudePermissionResolution | null {
    if (!this.pending || input.requestId !== this.pending.requestId) {
      return null;
    }
    const decision: PermissionResolutionDecision = input.decision === 'approved' ? 'approved' : 'denied';
    return this.finish(decision);
  }

  cancel(requestId?: string): ClaudePermissionResolution | null {
    if (!this.pending || (requestId && requestId !== this.pending.requestId)) {
      return null;
    }
    return this.finish('cancelled');
  }

  dispose(): void {
    this.clearTimer();
    this.pending = null;
    this.state = 'running';
  }

  getPendingPermission(): PendingPermissionState | null {
    return this.pending;
  }

  getState(): ClaudePermissionStateName {
    return this.state;
  }

  private finish(decision: PermissionResolutionDecision): ClaudePermissionResolution | null {
    const pending = this.pending;
    if (!pending || this.state !== 'awaiting_permission') {
      return null;
    }
    this.clearTimer();
    const requestId = pending.requestId;
    this.pending = null;
    this.state =
      decision === 'cancelled'
        ? 'cancelled'
        : decision === 'timed_out'
        ? 'timed_out'
        : 'permission_resolved';
    const resolvedAt = this.clock.now();
    const resolution = { requestId, decision, resolvedAt };
    this.onResolution?.(resolution);
    return resolution;
  }

  private handleTimeout(): void {
    this.finish('timed_out');
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
