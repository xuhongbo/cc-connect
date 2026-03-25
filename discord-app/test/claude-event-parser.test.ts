import { describe, expect, it, vi } from 'vitest';

import { ClaudeEventParser } from '../src/agents/claude/claude-event-parser.js';
import type {
  ClaudeEventParserResult,
  ClaudePermissionTransition,
} from '../src/agents/claude/claude-event-parser.js';
import { ClaudePermissionState } from '../src/agents/claude/claude-permission-state.js';
import type { PermissionResponseInput } from '../src/agents/types.js';
import type {
  AgentRuntimeEvent,
  SessionInitEvent,
  ThinkingEvent,
  ToolUseEvent,
  TextDeltaEvent,
  TextFinalEvent,
  TurnCompletedEvent,
} from '../src/agents/events.js';

function makeAssistantEvent(content: unknown[]) {
  return {
    type: 'assistant',
    message: { content },
  } as const;
}

function makeControlRequest(requestId: string, toolName = 'ToolX') {
  return {
    type: 'control_request',
    request_id: requestId,
    request: {
      subtype: 'can_use_tool',
      tool_name: toolName,
      input: { prompt: 'allow?' },
    },
  } as const;
}

describe('Claude event parser', () => {
  function assertEvent<T extends AgentRuntimeEvent>(event: AgentRuntimeEvent, kind: T['kind']): asserts event is T {
    expect(event.kind).toBe(kind);
  }

  it('emits session_init for system session events', () => {
    const parser = new ClaudeEventParser();
    const result = parser.parse({ type: 'system', session_id: 'sid' });
    expect(result.events).toHaveLength(1);
    const [event] = result.events;
    assertEvent<SessionInitEvent>(event, 'session_init');
    expect(event.sessionId).toBe('sid');
  });

  it('translates assistant thinking items', () => {
    const parser = new ClaudeEventParser();
    const result = parser.parse(makeAssistantEvent([{ type: 'thinking', thinking: 'pondering' }]));
    expect(result.events).toHaveLength(1);
    const [event] = result.events;
    assertEvent<ThinkingEvent>(event, 'thinking');
    expect(event.content).toBe('pondering');
  });

  it('translates assistant tool_use items', () => {
    const parser = new ClaudeEventParser();
    const result = parser.parse(
      makeAssistantEvent([
        { type: 'tool_use', name: 'Lookup', input: { q: 'what?' }, tool_call_id: 'abc' },
      ]),
    );
    expect(result.events).toHaveLength(1);
    const [event] = result.events;
    assertEvent<ToolUseEvent>(event, 'tool_use');
    expect(event.toolName).toBe('Lookup');
    expect(event.toolInput).toEqual({ q: 'what?' });
  });

  it('translates assistant text into text_delta', () => {
    const parser = new ClaudeEventParser();
    const result = parser.parse(makeAssistantEvent([{ type: 'text', text: 'chunk' }]));
    expect(result.events).toHaveLength(1);
    const [event] = result.events;
    assertEvent<TextDeltaEvent>(event, 'text_delta');
    expect(event.content).toBe('chunk');
  });

  it('emits text_final then turn_completed for result events', () => {
    const parser = new ClaudeEventParser();
    const result = parser.parse({
      type: 'result',
      session_id: 'sid',
      result: 'done',
      usage: { input_tokens: 1, output_tokens: 2 },
    });
    expect(result.events).toHaveLength(2);
    const [finalEvent, turnEvent] = result.events;
    assertEvent<TextFinalEvent>(finalEvent, 'text_final');
    expect(finalEvent.content).toBe('done');
    assertEvent<TurnCompletedEvent>(turnEvent, 'turn_completed');
    expect(turnEvent.sessionId).toBe('sid');
    expect(turnEvent.usage).toEqual({ input_tokens: 1, output_tokens: 2 });
  });

  it('produces permission transition metadata without emitting events', () => {
    const parser = new ClaudeEventParser({ clock: { now: () => 'ts' } });
    const result = parser.parse(makeControlRequest('req-1', 'ToolInline'));
    expect(result.events).toHaveLength(0);
    const transition = result.permissionTransition;
    if (!transition) {
      throw new Error('expected start transition');
    }
    if (transition.type !== 'start') {
      throw new Error('expected start transition');
    }
    const startTransition: Extract<ClaudePermissionTransition, { type: 'start' }> = transition;
    expect(startTransition.request).toEqual({
      requestId: 'req-1',
      toolName: 'ToolInline',
      toolInput: { prompt: 'allow?' },
      toolCallId: undefined,
      requestedAt: 'ts',
    });
  });

  it('ignores additional control_request while one permission is pending', () => {
    const parser = new ClaudeEventParser();
    parser.parse(makeControlRequest('req-1'));
    const second = parser.parse(makeControlRequest('req-2'));
    expect(second.permissionTransition).toBeUndefined();
    expect(second.events).toHaveLength(0);
  });

  it('allows subsequent permission requests once pending cleared', () => {
    const parser = new ClaudeEventParser();
    parser.parse(makeControlRequest('req-3'));
    parser.releasePendingPermission('req-3');
    const next = parser.parse(makeControlRequest('req-4'));
    const transition = next.permissionTransition;
    if (!transition) {
      throw new Error('expected start transition');
    }
    if (transition.type !== 'start') {
      throw new Error('expected start transition');
    }
    const startTransition: Extract<ClaudePermissionTransition, { type: 'start' }> = transition;
    expect(startTransition.request.requestId).toBe('req-4');
  });

  it('emits cancel transition even without explicit pending request', () => {
    const parser = new ClaudeEventParser();
    const result = parser.parse({ type: 'control_cancel_request', request_id: 'missing' });
    expect(result.permissionTransition).toEqual({ type: 'cancel', requestId: 'missing' });
  });

  it('shares cancel transition when requestId matches', () => {
    const parser = new ClaudeEventParser();
    parser.parse(makeControlRequest('req-2'));
    const result = parser.parse({ type: 'control_cancel_request', request_id: 'req-2' });
    expect(result.permissionTransition).toEqual({ type: 'cancel', requestId: 'req-2' });
  });

  it('emits cancel for the actual pending request even after another start arrives', () => {
    const parser = new ClaudeEventParser();
    parser.parse(makeControlRequest('req-3', 'FirstTool'));
    parser.parse(makeControlRequest('req-4', 'SecondTool'));
    const result = parser.parse({ type: 'control_cancel_request', request_id: 'req-3' });
    expect(result.permissionTransition).toEqual({ type: 'cancel', requestId: 'req-3' });
  });
});

describe('Claude permission state', () => {
  it('starts request and times out', async () => {
    vi.useFakeTimers();
    try {
      const state = new ClaudePermissionState({ timeoutMs: 1, clock: { now: () => 'now' } });
      state.startRequest({ requestId: 'req-a', toolName: 'Tool' });
      await vi.advanceTimersToNextTimerAsync();
      expect(state.getPendingPermission()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('notifies observer when permission request times out', async () => {
    vi.useFakeTimers();
    try {
      const onResolution = vi.fn();
      const state = new ClaudePermissionState({
        timeoutMs: 1,
        clock: { now: () => 'now' },
        onResolution,
      });
      state.startRequest({ requestId: 'req-timeout', toolName: 'Tool' });
      await vi.advanceTimersToNextTimerAsync();
      expect(onResolution).toHaveBeenCalledTimes(1);
      const resolution = onResolution.mock.calls[0][0];
      expect(resolution.decision).toBe('timed_out');
      expect(resolution.requestId).toBe('req-timeout');
      expect(resolution.resolvedAt).toBe('now');
    } finally {
      vi.useRealTimers();
    }
  });

  it('respondPermission rejects incorrect requestId', () => {
    const state = new ClaudePermissionState({ clock: { now: () => 'now' } });
    state.startRequest({ requestId: 'req-b', toolName: 'Tool' });
    expect(state.respond({ requestId: 'wrong', decision: 'denied' })).toBeNull();
  });

  it('cancel ignores wrong requestId', () => {
    const state = new ClaudePermissionState({ clock: { now: () => 'now' } });
    state.startRequest({ requestId: 'req-c', toolName: 'Tool' });
    expect(state.cancel('wrong')).toBeNull();
  });

  it('respondPermission yields resolution once', () => {
    const state = new ClaudePermissionState({ clock: { now: () => 'now' } });
    state.startRequest({ requestId: 'req-d', toolName: 'Tool' });
    const resolution = state.respond({ requestId: 'req-d', decision: 'approved' });
    expect(resolution?.decision).toBe('approved');
    expect(state.getPendingPermission()).toBeNull();
  });
});
