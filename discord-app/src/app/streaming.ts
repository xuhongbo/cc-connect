import type { AgentRuntimeEvent } from '../agents/events.js';

export interface PreviewMessage {
  messageId: string;
  content: string;
}

export interface StreamingPreviewDeps {
  create(content: string): Promise<PreviewMessage>;
  update(messageId: string, content: string): Promise<void>;
  throttleMs: number;
}

export interface StreamingPreview {
  start(initialContent: string): Promise<void>;
  push(delta: string): Promise<void>;
  finish(finalContent: string): Promise<void>;
  fail(errorContent: string): Promise<void>;
  getMessageId(): string;
  applyEvent(event: AgentRuntimeEvent): Promise<void>;
}

export function createStreamingPreview(deps: StreamingPreviewDeps): StreamingPreview {
  let messageId = '';
  let currentText = '';

  return {
    async start(initialContent: string): Promise<void> {
      const created = await deps.create(initialContent);
      messageId = created.messageId;
      currentText = '';
    },
    async push(delta: string): Promise<void> {
      ensureStarted(messageId);
      currentText += delta;
      await deps.update(messageId, currentText);
    },
    async finish(finalContent: string): Promise<void> {
      ensureStarted(messageId);
      currentText = finalContent;
      await deps.update(messageId, currentText);
    },
    async fail(errorContent: string): Promise<void> {
      ensureStarted(messageId);
      currentText = errorContent;
      await deps.update(messageId, currentText);
    },
    getMessageId(): string {
      return messageId;
    },
    async applyEvent(event: AgentRuntimeEvent): Promise<void> {
      switch (event.kind) {
        case 'text_delta':
          await this.push(event.content);
          break;
        case 'text_final':
          await this.finish(event.content);
          break;
        case 'thinking':
          await this.push(`\n[thinking] ${event.content}`);
          break;
        case 'tool_use':
          await this.push(`\n[tool] ${event.toolName}`);
          break;
        case 'tool_result':
          if (event.content) {
            await this.push(`\n[result] ${event.content}`);
          }
          break;
        case 'permission_request':
          await this.push(`\n[permission] ${event.toolName}`);
          break;
        case 'turn_completed':
          await this.finish(currentText);
          break;
        case 'turn_failed':
          await this.fail(event.message);
          break;
        case 'runtime_error':
          await this.fail(event.message);
          break;
        default:
          break;
      }
    },
  };
}

function ensureStarted(messageId: string): void {
  if (!messageId) {
    throw new Error('streaming preview has not been started');
  }
}
