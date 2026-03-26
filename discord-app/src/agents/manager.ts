import type { AgentAdapter } from './types.js';

export interface AgentsManager {
  readonly kind: 'agents-manager';
  register(adapter: AgentAdapter): void;
  get(kind: string): AgentAdapter | undefined;
  listKinds(): string[];
}

export function createAgentsManager(): AgentsManager {
  const adapters = new Map<string, AgentAdapter>();

  return {
    kind: 'agents-manager',
    register(adapter: AgentAdapter): void {
      adapters.set(adapter.kind, adapter);
    },
    get(kind: string): AgentAdapter | undefined {
      return adapters.get(kind);
    },
    listKinds(): string[] {
      return Array.from(adapters.keys());
    },
  };
}
