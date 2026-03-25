import { CodexSessionRuntime } from './codex-session.js';
import type { AgentAdapter } from '../types.js';

interface BinaryCheckDeps {
  hasBinary(name: string): Promise<boolean>;
}

export function createCodexAdapter(deps: BinaryCheckDeps): AgentAdapter {
  return {
    kind: 'codex',
    runtimeKind: 'resume-per-turn',
    async createSession(_input) {
      const ok = await deps.hasBinary('codex');
      if (!ok) {
        throw new Error('codex CLI not available');
      }
      return new CodexSessionRuntime();
    },
    async detectAvailability() {
      return deps.hasBinary('codex');
    },
  };
}
