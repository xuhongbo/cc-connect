export interface PreviewTransport {
  create(content: string): Promise<{ messageId: string; content: string }>;
  update(messageId: string, content: string): Promise<void>;
}
