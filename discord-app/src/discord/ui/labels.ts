import type { AgentKind } from '../../domain/project.js';

export const AGENT_TAG_NAMES: Record<AgentKind, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
};
