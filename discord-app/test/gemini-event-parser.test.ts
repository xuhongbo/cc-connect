import { describe, expect, it } from 'vitest';

import { createGeminiEventParser } from '../src/agents/gemini/gemini-event-parser.js';

describe('Gemini event parser', () => {
  it('emits session init and text delta for init and delta messages', () => {
    const parser = createGeminiEventParser();
    const initEvents = parser.parse({ type: 'init', session_id: 'gemini-1' });
    expect(initEvents).toEqual([
      expect.objectContaining({ kind: 'session_init', sessionId: 'gemini-1' }),
    ]);

    const deltaEvents = parser.parse({ type: 'message', role: 'assistant', content: 'stream', delta: true });
    expect(deltaEvents).toEqual([
      expect.objectContaining({ kind: 'text_delta', content: 'stream' }),
    ]);
  });

  it('buffers non-delta messages until result and then emits text_final with turn_completed', () => {
    const parser = createGeminiEventParser();
    parser.parse({ type: 'message', role: 'assistant', content: 'final message', delta: false });

    const completionEvents = parser.parse({ type: 'result', status: 'ok' });
    expect(completionEvents).toEqual([
      expect.objectContaining({ kind: 'text_final', content: 'final message' }),
      expect.objectContaining({ kind: 'turn_completed' }),
    ]);
  });

  it('treats success status as a completion signal', () => {
    const parser = createGeminiEventParser();
    parser.parse({ type: 'message', role: 'assistant', content: 'finalized', delta: false });

    const completionEvents = parser.parse({ type: 'result', status: 'success' });
    expect(completionEvents).toEqual([
      expect.objectContaining({ kind: 'text_final', content: 'finalized' }),
      expect.objectContaining({ kind: 'turn_completed' }),
    ]);
  });

  it('flushes buffered text to thinking before tool use and surfaces tool_result output', () => {
    const parser = createGeminiEventParser();
    parser.parse({ type: 'message', role: 'assistant', content: 'pre-tool', delta: false });

    const toolUseEvents = parser.parse({
      type: 'tool_use',
      tool_name: 'search',
      tool_id: 'search-1',
      parameters: { query: 'term' },
    });

    expect(toolUseEvents).toEqual([
      expect.objectContaining({ kind: 'thinking', content: 'pre-tool' }),
      expect.objectContaining({
        kind: 'tool_use',
        toolName: 'search',
        toolCallId: 'search-1',
        toolInput: { query: 'term' },
      }),
    ]);

    const toolResultEvents = parser.parse({
      type: 'tool_result',
      tool_name: 'search',
      tool_id: 'search-1',
      status: 'ok',
      output: 'found',
    });

    expect(toolResultEvents).toEqual([
      expect.objectContaining({ kind: 'tool_result', toolName: 'search', isError: false, content: 'found' }),
    ]);
  });

  it('turn result failures and runtime errors expose proper failure kinds', () => {
    const parser = createGeminiEventParser();

    const failureEvents = parser.parse({ type: 'result', status: 'error', error: { message: 'oom!' } });
    expect(failureEvents).toEqual([
      expect.objectContaining({ kind: 'turn_failed', message: 'oom!', failureKind: 'recoverable_turn_failure' }),
    ]);

    const runtimeEvents = parser.parse({ type: 'error', severity: 'ERROR', message: 'fatal' });
    expect(runtimeEvents[0]).toMatchObject({
      kind: 'runtime_error',
      runtimeFailureKind: 'runtime_broken',
      message: 'fatal',
    });

    const transientEvents = parser.parse({ type: 'error', severity: 'WARNING', message: 'rate limit' });
    expect(transientEvents[0]).toMatchObject({
      kind: 'runtime_error',
      runtimeFailureKind: 'transient_warning',
      message: 'rate limit',
    });
  });

  it('does not emit text_final when error result arrives after buffering', () => {
    const parser = createGeminiEventParser();
    parser.parse({ type: 'message', role: 'assistant', content: 'partial final', delta: false });

    const failureEvents = parser.parse({ type: 'result', status: 'error', error: { message: 'boom' } });
    expect(failureEvents).toEqual([
      expect.objectContaining({ kind: 'turn_failed', message: 'boom', failureKind: 'recoverable_turn_failure' }),
    ]);
    expect(failureEvents.some((event) => event.kind === 'text_final')).toBe(false);
  });

  it('clears buffered text after error so subsequent tool use stays clean', () => {
    const parser = createGeminiEventParser();
    parser.parse({ type: 'message', role: 'assistant', content: 'leftover text', delta: false });

    parser.parse({ type: 'result', status: 'error', error: { message: 'boom' } });

    const toolUseEvents = parser.parse({
      type: 'tool_use',
      tool_name: 'search',
      tool_id: 'search-2',
      parameters: { query: 'fresh' },
    });

    expect(toolUseEvents).toEqual([
      expect.objectContaining({
        kind: 'tool_use',
        toolName: 'search',
        toolCallId: 'search-2',
        toolInput: { query: 'fresh' },
      }),
    ]);
    expect(toolUseEvents.some((event) => event.kind === 'thinking')).toBe(false);
  });

  it('ignores invalid payloads while keeping parse signature open', () => {
    const parser = createGeminiEventParser();
    const unknownPayload: unknown = 42;
    expect(parser.parse(unknownPayload)).toEqual([]);
  });
});
