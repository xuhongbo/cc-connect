import type { Project } from '../../domain/project.js';
import { loadCollection, saveCollection, type StorageHandle } from '../db.js';

const FILE_NAME = 'projects.json';

export function createProjectsRepo(storage: StorageHandle) {
  return {
    async upsert(project: Project): Promise<void> {
      const projects = await loadCollection<Project>(storage, FILE_NAME);
      const next = replaceBy(projects, project, (item) => item.id === project.id);
      await saveCollection(storage, FILE_NAME, next);
    },
    async getById(id: string): Promise<Project | null> {
      const projects = await loadCollection<Project>(storage, FILE_NAME);
      return projects.find((project) => project.id === id) ?? null;
    },
    async getByChannelId(channelId: string): Promise<Project | null> {
      const projects = await loadCollection<Project>(storage, FILE_NAME);
      return projects.find((project) => project.channelId === channelId) ?? null;
    },
    async list(): Promise<Project[]> {
      return loadCollection<Project>(storage, FILE_NAME);
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
