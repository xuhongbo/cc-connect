import type { LastTurnSnapshot } from '../../domain/last-turn.js';
import { loadCollection, saveCollection, type StorageHandle } from '../db.js';

const FILE_NAME = 'last-turns.json';

export function createLastTurnRepo(storage: StorageHandle) {
  return {
    async upsert(snapshot: LastTurnSnapshot): Promise<void> {
      const snapshots = await loadCollection<LastTurnSnapshot>(storage, FILE_NAME);
      const next = replaceBy(snapshots, snapshot, (item) => item.threadRecordId === snapshot.threadRecordId);
      await saveCollection(storage, FILE_NAME, next);
    },
    async getByThreadRecordId(threadRecordId: string): Promise<LastTurnSnapshot | null> {
      const snapshots = await loadCollection<LastTurnSnapshot>(storage, FILE_NAME);
      return snapshots.find((snapshot) => snapshot.threadRecordId === threadRecordId) ?? null;
    },
    async list(): Promise<LastTurnSnapshot[]> {
      return loadCollection<LastTurnSnapshot>(storage, FILE_NAME);
    },
  };
}

function replaceBy<T>(items: T[], item: T, matcher: (candidate: T) => boolean): T[] {
  const index = items.findIndex(matcher);
  if (index === -1) {
    return [...items, item];
  }
  return [...items.slice(0, index), item, ...items.slice(index + 1)];
}
