import type { ConversationThread } from '../../domain/thread.js';
import { loadCollection, saveCollection, type StorageHandle } from '../db.js';

const FILE_NAME = 'threads.json';

export function createThreadsRepo(storage: StorageHandle) {
  return {
    async upsert(thread: ConversationThread): Promise<void> {
      const threads = await loadCollection<ConversationThread>(storage, FILE_NAME);
      const next = replaceBy(threads, thread, (item) => item.id === thread.id);
      await saveCollection(storage, FILE_NAME, next);
    },
    async getById(id: string): Promise<ConversationThread | null> {
      const threads = await loadCollection<ConversationThread>(storage, FILE_NAME);
      return threads.find((thread) => thread.id === id) ?? null;
    },
    async getByThreadId(threadId: string): Promise<ConversationThread | null> {
      const threads = await loadCollection<ConversationThread>(storage, FILE_NAME);
      return threads.find((thread) => thread.threadId === threadId) ?? null;
    },
    async listByProjectId(projectId: string): Promise<ConversationThread[]> {
      const threads = await loadCollection<ConversationThread>(storage, FILE_NAME);
      return threads.filter((thread) => thread.projectId === projectId);
    },
    async list(): Promise<ConversationThread[]> {
      return loadCollection<ConversationThread>(storage, FILE_NAME);
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
