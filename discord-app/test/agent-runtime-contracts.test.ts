import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  createRuntimeErrorEvent,
  createSessionInitEvent,
  createTurnFailedEvent,
  createTurnStartedEvent,
  type AgentRuntimeEventKind,
  type AgentRuntimeEvent,
  type AgentRuntimeRuntimeFailureKind,
  type AgentRuntimeTurnFailureKind,
} from '../src/agents/events.js';
import type {
  AgentAdapter,
  AgentRuntimeInput,
  AgentRuntimeProjectContext,
  AgentSessionRuntime,
  CreateAgentSessionInput,
  PermissionResponseInput,
  PendingPermissionState,
  RuntimeFileRef,
  RuntimeImageRef,
} from '../src/agents/types.js';
import type { AgentSessionBinding } from '../src/domain/session-binding.js';
import type { LastTurnSnapshot } from '../src/domain/last-turn.js';

const requiredEventKinds = [
  'session_init',
  'turn_started',
  'text_delta',
  'text_final',
  'thinking',
  'tool_use',
  'tool_result',
  'permission_request',
  'permission_resolved',
  'turn_completed',
  'turn_failed',
  'runtime_error',
] as const;

describe('agent runtime contracts', () => {
  it('defines the session creation context', () => {
    expectTypeOf<CreateAgentSessionInput>().toEqualTypeOf<{
      workDir: string;
      binding: AgentSessionBinding;
      projectContext: AgentRuntimeProjectContext;
      lastTurn?: LastTurnSnapshot | null;
    }>();

    expectTypeOf<AgentAdapter['createSession']>().toEqualTypeOf<
      (input: CreateAgentSessionInput) => Promise<AgentSessionRuntime>
    >();
  });

  it('exposes runtime helpers and event stream', () => {
    expectTypeOf<AgentSessionRuntime['events']>().toEqualTypeOf<() => AsyncIterable<AgentRuntimeEvent>>();
    expectTypeOf<AgentSessionRuntime['respondPermission']>().toEqualTypeOf<
      (input: PermissionResponseInput) => Promise<void>
    >();
    expectTypeOf<AgentSessionRuntime['getPendingPermission']>().toEqualTypeOf<() => PendingPermissionState | null>();
  });

  it('restricts runtime inputs to text, files, and images', () => {
    expectTypeOf<AgentRuntimeInput>().toEqualTypeOf<{
      text?: string;
      files?: RuntimeFileRef[];
      images?: RuntimeImageRef[];
    }>();
  });

  it('covers all runtime event kinds and failure classifications', () => {
    expectTypeOf<AgentRuntimeEventKind>().toEqualTypeOf<(typeof requiredEventKinds)[number]>();
    expectTypeOf<AgentRuntimeEvent['kind']>().toEqualTypeOf<AgentRuntimeEventKind>();

    const sessionInit = createSessionInitEvent({ sessionId: 'session' });
    const turnStarted = createTurnStartedEvent({});
    const turnFailed = createTurnFailedEvent({
      message: 'failure',
      failureKind: 'recoverable_turn_failure',
    });
    const runtimeError = createRuntimeErrorEvent({
      message: 'error',
      runtimeFailureKind: 'runtime_broken',
    });

    expect(sessionInit.kind).toBe('session_init');
    expect(turnStarted.kind).toBe('turn_started');
    expect(turnFailed.failureKind).toBe('recoverable_turn_failure');
    expect(runtimeError.runtimeFailureKind).toBe('runtime_broken');

    expectTypeOf<typeof turnFailed.failureKind>().toEqualTypeOf<AgentRuntimeTurnFailureKind>();
    expectTypeOf<typeof runtimeError.runtimeFailureKind>().toEqualTypeOf<AgentRuntimeRuntimeFailureKind>();
  });
});
