export interface ThreadTurnState {
  busy: boolean;
}

export function createThreadSessionMap() {
  const states = new Map<string, ThreadTurnState>();

  return {
    tryBeginTurn(threadRecordId: string): boolean {
      const current = states.get(threadRecordId);
      if (current?.busy) {
        return false;
      }
      states.set(threadRecordId, { busy: true });
      return true;
    },
    finishTurn(threadRecordId: string): void {
      states.set(threadRecordId, { busy: false });
    },
    isBusy(threadRecordId: string): boolean {
      return states.get(threadRecordId)?.busy ?? false;
    },
  };
}
