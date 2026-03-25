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
  };
}

function ensureStarted(messageId: string): void {
  if (!messageId) {
    throw new Error('streaming preview has not been started');
  }
}
