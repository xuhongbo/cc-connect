import type { AgentSessionBinding } from '../../domain/session-binding.js';
import { loadCollection, saveCollection, type StorageHandle } from '../db.js';

const FILE_NAME = 'session-bindings.json';

export function createSessionBindingsRepo(storage: StorageHandle) {
  return {
    async upsert(binding: AgentSessionBinding): Promise<void> {
      const bindings = await loadCollection<AgentSessionBinding>(storage, FILE_NAME);
      const next = replaceBy(bindings, binding, (item) => item.id === binding.id);
      await saveCollection(storage, FILE_NAME, next);
    },
    async getByThreadRecordId(threadRecordId: string): Promise<AgentSessionBinding | null> {
      const bindings = await loadCollection<AgentSessionBinding>(storage, FILE_NAME);
      return bindings.find((binding) => binding.threadRecordId === threadRecordId) ?? null;
    },
    async list(): Promise<AgentSessionBinding[]> {
      return loadCollection<AgentSessionBinding>(storage, FILE_NAME);
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
