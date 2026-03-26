import type { Project } from '../domain/project.js';

export interface ProjectsRepoLike {
  getByChannelId(channelId: string): Promise<Project | null>;
}

export interface Router {
  resolveProjectForSessionCommand(channelId: string): Promise<{ project: Project }>;
}

export function createRouter(deps: { projectsRepo: ProjectsRepoLike }): Router {
  return {
    async resolveProjectForSessionCommand(channelId: string) {
      const project = await deps.projectsRepo.getByChannelId(channelId);
      if (!project) {
        throw new Error('This command must be used inside a configured project channel.');
      }
      return { project };
    },
  };
}
