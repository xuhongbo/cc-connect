import type { AgentRuntimeEvent } from '../events.js';
import {
  createRuntimeErrorEvent,
  createSessionInitEvent,
  createThinkingEvent,
  createToolUseEvent,
  createTurnCompletedEvent,
  createTurnFailedEvent,
  createTurnStartedEvent,
  createTextFinalEvent,
} from '../events.js';

type CodexRawEvent = Record<string, unknown>;
type CodexItem = Record<string, unknown>;

interface CodexEventParser {
  parse(raw: unknown): AgentRuntimeEvent[];
}

function getString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function getItem(raw: CodexRawEvent): CodexItem | undefined {
  const item = raw['item'];
  if (item && typeof item === 'object') {
    return item as CodexItem;
  }
  return undefined;
}

function extractItemContent(item: CodexItem): string {
  return (
    getString(item['content']) ||
    getString(item['text']) ||
    getString(item['output_text']) ||
    getString(item['summary'])
  );
}

function isRecord(value: unknown): value is CodexRawEvent {
  return typeof value === 'object' && value !== null;
}

export function createCodexEventParser(): CodexEventParser {
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

  function handleToolStart(item: CodexItem, raw: CodexRawEvent, events: AgentRuntimeEvent[]) {
    const itemType = getString(item['type']);
    const flushEvents = flushPendingAsThinking();
    events.push(...flushEvents);

    let toolInput: unknown | undefined;
    if (itemType === 'command_execution') {
      toolInput = getString(item['command']);
    } else if (itemType === 'function_call') {
      toolInput = getString(item['arguments']) || item['arguments'];
    }

    const toolName =
      itemType === 'function_call'
        ? getString(item['name']) || itemType
        : itemType || 'command_execution';

    events.push(
      createToolUseEvent({
        toolName,
        raw,
        toolInput,
      }),
    );
  }

  function handleItemCompleted(raw: CodexRawEvent, events: AgentRuntimeEvent[]) {
    const item = getItem(raw);
    if (!item) {
      return;
    }
    const itemType = getString(item['type']);

    if (itemType === 'reasoning') {
      const summary = extractItemContent(item);
      if (summary) {
        events.push(createThinkingEvent({ content: summary }));
      }
      return;
    }

    if (itemType === 'agent_message' || itemType === 'message') {
      const text = extractItemContent(item);
      if (text) {
        pendingText += text;
      }
    }
  }

  function handleTurnCompleted(raw: CodexRawEvent, events: AgentRuntimeEvent[]) {
    const textEvents = flushPendingAsTextFinal();
    events.push(...textEvents);
    events.push(createTurnCompletedEvent({ sessionId, raw }));
  }

  function handleTurnFailed(raw: CodexRawEvent, events: AgentRuntimeEvent[]) {
    const failureMessage = getString(raw['error'] && typeof raw['error'] === 'object' ? (raw['error'] as Record<string, unknown>)['message'] : raw['error']);
    const message = failureMessage || 'turn failed';
    events.push(
      createTurnFailedEvent({
        message,
        failureKind: 'recoverable_turn_failure',
        raw,
      }),
    );
  }

  function handleRuntimeError(raw: CodexRawEvent, events: AgentRuntimeEvent[]) {
    const severity = getString(raw['severity']).toLowerCase();
    const runtimeFailureKind = severity === 'warning' ? 'transient_warning' : 'runtime_broken';
    const message = getString(raw['message']) || 'Codex runtime error';
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
      const eventType = getString(raw['type']);

      switch (eventType) {
        case 'thread.started': {
          const tid = getString(raw['thread_id']);
          if (tid) {
            sessionId = tid;
            events.push(createSessionInitEvent({ sessionId: tid }));
          }
          break;
        }
        case 'turn.started':
          pendingText = '';
          events.push(createTurnStartedEvent({ sessionId }));
          break;
        case 'item.started': {
          const item = getItem(raw);
          if (!item) {
            break;
          }
          const itemType = getString(item['type']);
          if (itemType === 'command_execution' || itemType === 'function_call') {
            handleToolStart(item, raw, events);
          }
          break;
        }
        case 'item.completed':
          handleItemCompleted(raw, events);
          break;
        case 'turn.completed':
          handleTurnCompleted(raw, events);
          break;
        case 'turn.failed':
          handleTurnFailed(raw, events);
          break;
        case 'error':
          handleRuntimeError(raw, events);
          break;
        default:
          break;
      }

      return events;
    },
  };
}
