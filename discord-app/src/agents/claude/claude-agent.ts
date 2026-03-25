import { ClaudeSessionRuntime } from './claude-session.js';
import type { AgentAdapter } from '../types.js';

interface BinaryCheckDeps {
  hasBinary(name: string): Promise<boolean>;
}

export function createClaudeAdapter(deps: BinaryCheckDeps): AgentAdapter {
  return {
    kind: 'claude',
    runtimeKind: 'persistent',
    async createSession(input) {
      const command = input.binding.cliBin || 'claude';
      const ok = await deps.hasBinary(command);
      if (!ok) {
        throw new Error(`${command} CLI not available`);
      }
      return new ClaudeSessionRuntime({
        workDir: input.workDir,
        binding: input.binding,
        projectContext: input.projectContext,
        lastTurn: input.lastTurn ?? null,
      });
    },
    async detectAvailability() {
      return deps.hasBinary('claude');
    },
  };
}
