import { ClaudeSessionRuntime } from './claude-session.js';
import type { AgentAdapter } from '../types.js';

interface BinaryCheckDeps {
  hasBinary(name: string): Promise<boolean>;
}

export function createClaudeAdapter(deps: BinaryCheckDeps): AgentAdapter {
  return {
    kind: 'claude',
    runtimeKind: 'persistent',
    async createSession(_input) {
      const ok = await deps.hasBinary('claude');
      if (!ok) {
        throw new Error('claude CLI not available');
      }
      return new ClaudeSessionRuntime();
    },
    async detectAvailability() {
      return deps.hasBinary('claude');
    },
  };
}
