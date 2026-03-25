import { GeminiSessionRuntime } from './gemini-session.js';
import type { AgentAdapter } from '../types.js';

interface BinaryCheckDeps {
  hasBinary(name: string): Promise<boolean>;
}

export function createGeminiAdapter(deps: BinaryCheckDeps): AgentAdapter {
  return {
    kind: 'gemini',
    runtimeKind: 'resume-per-turn',
    async createSession(_input) {
      const ok = await deps.hasBinary('gemini');
      if (!ok) {
        throw new Error('gemini CLI not available');
      }
      return new GeminiSessionRuntime();
    },
    async detectAvailability() {
      return deps.hasBinary('gemini');
    },
  };
}
