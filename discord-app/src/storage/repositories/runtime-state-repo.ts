import type { RuntimeState } from '../../domain/runtime-state.js';
import { loadCollection, saveCollection, type StorageHandle } from '../db.js';

const FILE_NAME = 'runtime-states.json';

export function createRuntimeStateRepo(storage: StorageHandle) {
  return {
    async upsert(state: RuntimeState): Promise<void> {
      const states = await loadCollection<RuntimeState>(storage, FILE_NAME);
      const next = replaceBy(states, state, (item) => item.threadRecordId === state.threadRecordId);
      await saveCollection(storage, FILE_NAME, next);
    },
    async getByThreadRecordId(threadRecordId: string): Promise<RuntimeState | null> {
      const states = await loadCollection<RuntimeState>(storage, FILE_NAME);
      return states.find((state) => state.threadRecordId === threadRecordId) ?? null;
    },
    async list(): Promise<RuntimeState[]> {
      return loadCollection<RuntimeState>(storage, FILE_NAME);
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
