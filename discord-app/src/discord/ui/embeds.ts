export function buildStatusText(agentLabel: string, content: string): string {
  return `${agentLabel} ${content}`.trim();
}

export function buildRuntimeErrorText(message: string): string {
  return `执行失败：${message}`;
}
