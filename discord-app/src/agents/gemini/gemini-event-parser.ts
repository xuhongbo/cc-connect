import type { AgentRuntimeEvent } from '../events.js';
import {
  createRuntimeErrorEvent,
  createSessionInitEvent,
  createThinkingEvent,
  createTextDeltaEvent,
  createTextFinalEvent,
  createToolResultEvent,
  createToolUseEvent,
  createTurnCompletedEvent,
  createTurnFailedEvent,
} from '../events.js';

type GeminiRawEvent = Record<string, unknown>;

function getString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isRecord(value: unknown): value is GeminiRawEvent {
  return typeof value === 'object' && value !== null;
}

export function createGeminiEventParser() {
  let sessionId: string | undefined;
  let pendingText = '';

  function flushPendingAsThinking(): AgentRuntimeEvent[] {
    if (!pendingText) {
      return [];
    }
    const event = createThinkingEvent({ content: pendingText });
    pendingText = '';
    return [event];
  }

  function flushPendingAsTextFinal(): AgentRuntimeEvent[] {
    if (!pendingText) {
      return [];
    }
    const event = createTextFinalEvent({ content: pendingText });
    pendingText = '';
    return [event];
  }

  function handleToolUse(raw: GeminiRawEvent, events: AgentRuntimeEvent[]) {
    events.push(...flushPendingAsThinking());
    const toolName = getString(raw['tool_name']);
    const toolCallId = getString(raw['tool_id']);
    const toolInput = raw['parameters'];
    events.push(
      createToolUseEvent({
        toolName: toolName || 'tool',
        toolCallId: toolCallId || undefined,
        toolInput,
      }),
    );
  }

  function handleToolResult(raw: GeminiRawEvent, events: AgentRuntimeEvent[]) {
    const toolName = getString(raw['tool_name']) || getString(raw['tool_id']);
    const toolCallId = getString(raw['tool_id']);
    const status = getString(raw['status']).toLowerCase();
    const output = getString(raw['output']);
    const isError = status === 'error';
    const content = output || undefined;
    events.push(
      createToolResultEvent({
        toolName,
        toolCallId: toolCallId || undefined,
        isError,
        content,
      }),
    );
  }

  function handleResult(raw: GeminiRawEvent, events: AgentRuntimeEvent[]) {
    const status = getString(raw['status']).toLowerCase();
    const success = status === 'ok' || status === 'success';
    if (success) {
      const textEvents = flushPendingAsTextFinal();
      events.push(...textEvents);
      events.push(createTurnCompletedEvent({ sessionId, raw }));
      return;
    }
    const errMsg = (raw['error'] && typeof raw['error'] === 'object' ? getString((raw['error'] as Record<string, unknown>)['message']) : '') || 'result error';
    events.push(
      createTurnFailedEvent({
        message: errMsg,
        failureKind: 'recoverable_turn_failure',
        raw,
      }),
    );
    pendingText = '';
  }

  function handleError(raw: GeminiRawEvent, events: AgentRuntimeEvent[]) {
    const severity = getString(raw['severity']).toLowerCase();
    const message = getString(raw['message']) || 'gemini error';
    const runtimeFailureKind = severity === 'warning' ? 'transient_warning' : 'runtime_broken';
    events.push(
      createRuntimeErrorEvent({
        message,
        runtimeFailureKind,
        raw,
      }),
    );
  }

  return {
    parse(raw: unknown): AgentRuntimeEvent[] {
      if (!isRecord(raw)) {
        return [];
      }
      const events: AgentRuntimeEvent[] = [];
      const type = getString(raw['type']);

      switch (type) {
        case 'init': {
          const sid = getString(raw['session_id']);
          if (sid) {
            sessionId = sid;
            events.push(createSessionInitEvent({ sessionId: sid }));
          }
          break;
        }
        case 'message': {
          const role = getString(raw['role']);
          const content = getString(raw['content']);
          if (role !== 'assistant' || !content) {
            break;
          }
          const delta = raw['delta'] as boolean | undefined;
          if (delta) {
            events.push(createTextDeltaEvent({ content }));
            break;
          }
          pendingText += content;
          break;
        }
        case 'tool_use':
          handleToolUse(raw, events);
          break;
        case 'tool_result':
          handleToolResult(raw, events);
          break;
        case 'result':
          handleResult(raw, events);
          break;
        case 'error':
          handleError(raw, events);
          break;
        default:
          break;
      }

      return events;
    },
  };
}
