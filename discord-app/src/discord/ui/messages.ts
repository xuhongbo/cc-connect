export interface PreviewTransport {
  create(content: string): Promise<{ messageId: string; content: string }>;
  update(messageId: string, content: string): Promise<void>;
}

export function buildPermissionStatusMessage(toolName: string): string {
  return `等待权限确认：${toolName}`;
}
