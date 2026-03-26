export type AgentKind = 'claude' | 'codex' | 'gemini';
export type ProjectChannelType = 'guildText' | 'guildForum';
export type ProjectStatus = 'active' | 'disabled' | 'error';

export interface Project {
  id: string;
  name: string;
  guildId: string;
  channelId: string;
  channelType: ProjectChannelType;
  baseWorkDir: string;
  currentWorkDir: string;
  defaultAgent: AgentKind;
  defaultModel: string;
  defaultMode: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectInput {
  id: string;
  name: string;
  guildId: string;
  channelId: string;
  channelType: ProjectChannelType;
  baseWorkDir: string;
  defaultAgent: AgentKind;
  defaultModel?: string;
  defaultMode?: string;
  status?: ProjectStatus;
}

export function createProject(input: CreateProjectInput): Project {
  const now = new Date().toISOString();
  return {
    id: input.id,
    name: input.name,
    guildId: input.guildId,
    channelId: input.channelId,
    channelType: input.channelType,
    baseWorkDir: input.baseWorkDir,
    currentWorkDir: input.baseWorkDir,
    defaultAgent: input.defaultAgent,
    defaultModel: input.defaultModel ?? '',
    defaultMode: input.defaultMode ?? '',
    status: input.status ?? 'active',
    createdAt: now,
    updatedAt: now,
  };
}
