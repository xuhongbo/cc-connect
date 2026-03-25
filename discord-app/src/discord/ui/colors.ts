import type { AgentKind } from '../../domain/project.js';

export const AGENT_COLORS: Record<AgentKind, number> = {
  claude: 0x7c3aed,
  codex: 0x16a34a,
  gemini: 0xd4a017,
};
