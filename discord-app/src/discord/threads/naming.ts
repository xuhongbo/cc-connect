import type { AgentKind } from '../../domain/project.js';

const AGENT_LABELS: Record<AgentKind, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
};

export function threadPrefixForAgent(agentKind: AgentKind): string {
  return `[${AGENT_LABELS[agentKind]}]`;
}

export function buildThreadTitle(agentKind: AgentKind, requestedTitle: string): string {
  const title = requestedTitle.trim() || 'New Session';
  return `${threadPrefixForAgent(agentKind)} ${title}`;
}
