import { describe, expect, it } from 'vitest';

import { createAgentSessionBinding } from '../src/domain/session-binding.js';
import { createProject } from '../src/domain/project.js';
import { createClaudeAdapter } from '../src/agents/claude/claude-agent.js';
import { createCodexAdapter } from '../src/agents/codex/codex-agent.js';
import { createGeminiAdapter } from '../src/agents/gemini/gemini-agent.js';

describe('agent runtime skeletons', () => {
  it('marks Claude as persistent and reports missing cli clearly', async () => {
    const adapter = createClaudeAdapter({ hasBinary: async () => false });

    expect(adapter.kind).toBe('claude');
    expect(adapter.runtimeKind).toBe('persistent');
    await expect(adapter.detectAvailability()).resolves.toBe(false);
    const project = createProject({
      id: 'proj-1',
      name: 'Test',
      guildId: 'g1',
      channelId: 'c1',
      channelType: 'guildText',
      baseWorkDir: '/tmp',
      defaultAgent: 'claude',
      defaultModel: 'claude-1',
      defaultMode: 'dev',
    });
    const projectContext = {
      projectId: project.id,
      defaultAgent: project.defaultAgent,
      defaultModel: project.defaultModel,
      defaultMode: project.defaultMode,
    } as const;
    const binding = createAgentSessionBinding({
      id: 'binding-1',
      threadRecordId: 't1',
      agentKind: 'claude',
      runtimeKind: 'persistent',
      resumeStrategy: 'stdio',
      cliBin: 'claude',
    });
    await expect(adapter.createSession({
      workDir: project.currentWorkDir,
      binding,
      projectContext,
      lastTurn: null,
    })).rejects.toThrow(/claude/i);
  });

  it('marks Codex and Gemini as resume-per-turn', async () => {
    const codex = createCodexAdapter({ hasBinary: async () => true });
    const gemini = createGeminiAdapter({ hasBinary: async () => true });

    expect(codex.runtimeKind).toBe('resume-per-turn');
    expect(gemini.runtimeKind).toBe('resume-per-turn');
    await expect(codex.detectAvailability()).resolves.toBe(true);
    await expect(gemini.detectAvailability()).resolves.toBe(true);
  });
});
