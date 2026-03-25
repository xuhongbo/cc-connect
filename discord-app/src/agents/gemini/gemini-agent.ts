import { GeminiSessionRuntime } from './gemini-session.js';
import type { AgentAdapter } from '../types.js';
import type { GeminiSessionRuntimeDeps } from './gemini-session.js';

interface BinaryCheckDeps {
  hasBinary(name: string): Promise<boolean>;
  timeoutMs?: number;
  runtimeDeps?: GeminiSessionRuntimeDeps;
}

export function createGeminiAdapter(deps: BinaryCheckDeps): AgentAdapter {
  return {
    kind: 'gemini',
    runtimeKind: 'resume-per-turn',
    async createSession(input) {
      const command = input.binding.cliBin || 'gemini';
      const ok = await deps.hasBinary(command);
      if (!ok) {
        throw new Error(`${command} CLI not available`);
      }
      return new GeminiSessionRuntime({
        input,
        timeoutMs: deps.timeoutMs,
        deps: deps.runtimeDeps,
      });
    },
    async detectAvailability() {
      return deps.hasBinary('gemini');
    },
  };
}
