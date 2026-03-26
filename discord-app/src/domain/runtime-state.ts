export interface RuntimeState {
  threadRecordId: string;
  isBusy: boolean;
  lastMessageId: string;
  lastPreviewMessageId: string;
  lastError: string;
  queuedMessageCount: number;
  updatedAt: string;
}

export function createRuntimeState(threadRecordId: string): RuntimeState {
  return {
    threadRecordId,
    isBusy: false,
    lastMessageId: '',
    lastPreviewMessageId: '',
    lastError: '',
    queuedMessageCount: 0,
    updatedAt: new Date().toISOString(),
  };
}
