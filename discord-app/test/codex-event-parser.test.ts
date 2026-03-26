import { describe, expect, it } from 'vitest';

import { createCodexEventParser } from '../src/agents/codex/codex-event-parser.js';

describe('Codex event parser', () => {
  it('emits session init and turn started events', () => {
    const parser = createCodexEventParser();
    const sessionEvents = parser.parse({ type: 'thread.started', thread_id: 'codex-thread' });
    expect(sessionEvents).toHaveLength(1);
    expect(sessionEvents[0]).toMatchObject({ kind: 'session_init', sessionId: 'codex-thread' });

    const turnEvents = parser.parse({ type: 'turn.started' });
    expect(turnEvents).toHaveLength(1);
    expect(turnEvents[0]).toMatchObject({ kind: 'turn_started', sessionId: 'codex-thread' });
  });

  it('flushes buffered agent messages to thinking before tools and text_final when the turn completes', () => {
    const parser = createCodexEventParser();
    parser.parse({ type: 'turn.started' });
    parser.parse({ type: 'item.completed', item: { type: 'agent_message', content: 'draft' } });

    const toolEvents = parser.parse({
      type: 'item.started',
      item: { type: 'command_execution', command: 'echo hello world' },
    });

    expect(toolEvents).toEqual([
      expect.objectContaining({ kind: 'thinking', content: 'draft' }),
      expect.objectContaining({ kind: 'tool_use', toolName: 'command_execution', toolInput: 'echo hello world' }),
    ]);

    parser.parse({ type: 'item.completed', item: { type: 'agent_message', content: 'final answer' } });
    const completionEvents = parser.parse({ type: 'turn.completed' });

    expect(completionEvents).toEqual([
      expect.objectContaining({ kind: 'text_final', content: 'final answer' }),
      expect.objectContaining({ kind: 'turn_completed' }),
    ]);
  });

  it('handles function_call tool start and message items', () => {
    const parser = createCodexEventParser();
    parser.parse({ type: 'turn.started' });
    parser.parse({ type: 'item.completed', item: { type: 'message', content: 'message text' } });

    const toolEvents = parser.parse({
      type: 'item.started',
      item: { type: 'function_call', name: 'myfunc', arguments: '{"a":1}' },
    });

    expect(toolEvents).toEqual([
      expect.objectContaining({ kind: 'thinking', content: 'message text' }),
      expect.objectContaining({ kind: 'tool_use', toolName: 'myfunc', toolInput: '{"a":1}' }),
    ]);
  });

  it('emits thinking from reasoning, converts turn failures, and surfaces runtime errors by kind', () => {
    const parser = createCodexEventParser();
    parser.parse({ type: 'turn.started' });

    const thinkingEvents = parser.parse({
      type: 'item.completed',
      item: { type: 'reasoning', summary: 'analysis pending' },
    });
    expect(thinkingEvents).toEqual([
      expect.objectContaining({ kind: 'thinking', content: 'analysis pending' }),
    ]);

    const failureEvents = parser.parse({ type: 'turn.failed', error: { message: 'boom' } });
    expect(failureEvents).toEqual([
      expect.objectContaining({ kind: 'turn_failed', message: 'boom', failureKind: 'recoverable_turn_failure' }),
    ]);

    const runtimeErrorEvents = parser.parse({ type: 'error', message: 'fatal err' });
    expect(runtimeErrorEvents[0]).toMatchObject({ kind: 'runtime_error', runtimeFailureKind: 'runtime_broken', message: 'fatal err' });

    const transientEvents = parser.parse({ type: 'error', message: 'Reconnecting soon', severity: 'warning' });
    expect(transientEvents[0]).toMatchObject({ kind: 'runtime_error', runtimeFailureKind: 'transient_warning' });
  });

  it('ignores non-object inputs without narrowing the parse signature', () => {
    const parser = createCodexEventParser();
    const unknownPayload: unknown = Symbol('invalid payload');
    expect(parser.parse(unknownPayload)).toEqual([]);
  });

  it('keeps buffered text from being emitted when turns fail', () => {
    const parser = createCodexEventParser();
    parser.parse({ type: 'turn.started' });
    parser.parse({ type: 'item.completed', item: { type: 'message', content: 'pending text' } });

    const failureEvents = parser.parse({ type: 'turn.failed', error: { message: 'failure' } });
    expect(failureEvents).toEqual([
      expect.objectContaining({ kind: 'turn_failed', message: 'failure', failureKind: 'recoverable_turn_failure' }),
    ]);
    expect(failureEvents.some((event) => event.kind === 'text_final')).toBe(false);
  });
});
