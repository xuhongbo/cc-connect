import type { AgentRuntimeEvent } from '../events.js';
import {
  createSessionInitEvent,
  createThinkingEvent,
  createTextDeltaEvent,
  createTextFinalEvent,
  createToolUseEvent,
  createTurnCompletedEvent,
} from '../events.js';

export interface ClaudePermissionRequestCandidate {
  requestId: string;
  toolName: string;
  toolInput?: unknown;
  toolCallId?: string;
  requestedAt: string;
}

export type ClaudePermissionTransition =
  | { type: 'start'; request: ClaudePermissionRequestCandidate }
  | { type: 'cancel'; requestId: string };

export interface ClaudeEventParserResult {
  events: AgentRuntimeEvent[];
  permissionTransition?: ClaudePermissionTransition;
}

export interface ClaudeEventParserOptions {
  clock?: { now(): string };
}

export class ClaudeEventParser {
  private readonly clock: { now(): string };
  private pendingRequestId: string | null = null;

  constructor(options?: ClaudeEventParserOptions) {
    this.clock = options?.clock ?? { now: () => new Date().toISOString() };
  }

  parse(raw: unknown): ClaudeEventParserResult {
    const events: AgentRuntimeEvent[] = [];
    let permissionTransition: ClaudePermissionTransition | undefined;

    if (!raw || typeof raw !== 'object') {
      return { events };
    }

    const data = raw as Record<string, unknown>;
    const type = typeof data.type === 'string' ? data.type : undefined;

    switch (type) {
      case 'system': {
        const sessionId = typeof data.session_id === 'string' ? data.session_id : undefined;
        if (sessionId) {
          events.push(createSessionInitEvent({ sessionId }));
        }
        break;
      }
      case 'assistant': {
        const message = data.message as { content?: unknown } | undefined;
        const content = Array.isArray(message?.content) ? message.content : [];
        for (const item of content) {
          if (!item || typeof item !== 'object') {
            continue;
          }
          const entry = item as Record<string, unknown>;
          const entryType = typeof entry.type === 'string' ? entry.type : undefined;
          switch (entryType) {
            case 'thinking': {
              const thinking = typeof entry.thinking === 'string' ? entry.thinking : undefined;
              if (thinking) {
                events.push(createThinkingEvent({ content: thinking }));
              }
              break;
            }
            case 'tool_use': {
              const toolName = typeof entry.name === 'string' ? entry.name : 'unknown';
              events.push(
                createToolUseEvent({
                  toolName,
                  toolInput: entry.input,
                  toolCallId: typeof entry.tool_call_id === 'string' ? entry.tool_call_id : undefined,
                }),
              );
              break;
            }
            case 'text': {
              const text = typeof entry.text === 'string' ? entry.text : undefined;
              if (text) {
                events.push(createTextDeltaEvent({ content: text }));
              }
              break;
            }
          }
        }
        break;
      }
      case 'result': {
        const content = typeof data.result === 'string' ? data.result : undefined;
        if (content) {
          events.push(createTextFinalEvent({ content }));
        }
        const sessionId = typeof data.session_id === 'string' ? data.session_id : undefined;
        const usage = typeof data.usage === 'object' && data.usage !== null ? data.usage : undefined;
        events.push(createTurnCompletedEvent({ sessionId, usage }));
        break;
      }
      case 'control_request': {
        const requestId = typeof data.request_id === 'string' ? data.request_id : undefined;
        const request = data.request as Record<string, unknown> | undefined;
        const subtype = typeof request?.subtype === 'string' ? request.subtype : undefined;
        const toolName = typeof request?.tool_name === 'string' ? request.tool_name : 'unknown';
        const toolInput = request?.input;
        const toolCallId = typeof request?.tool_call_id === 'string' ? request.tool_call_id : undefined;
        if (requestId && subtype === 'can_use_tool' && !this.pendingRequestId) {
          permissionTransition = {
            type: 'start',
            request: {
              requestId,
              toolName,
              toolInput,
              toolCallId,
              requestedAt: this.clock.now(),
            },
          };
          this.pendingRequestId = requestId;
        }
        break;
      }
      case 'control_cancel_request': {
        const requestId = typeof data.request_id === 'string' ? data.request_id : undefined;
        if (requestId) {
          this.releasePendingPermission(requestId);
          permissionTransition = { type: 'cancel', requestId };
        }
        break;
      }
    }

    return { events, permissionTransition };
  }

  releasePendingPermission(requestId?: string): void {
    if (!this.pendingRequestId) {
      return;
    }
    if (!requestId || requestId === this.pendingRequestId) {
      this.pendingRequestId = null;
    }
  }
}
