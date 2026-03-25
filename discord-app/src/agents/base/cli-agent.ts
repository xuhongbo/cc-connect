import type { AgentSessionRuntime } from '../types.js';

export class NoopSessionRuntime implements AgentSessionRuntime {
  async send(): Promise<void> {
    return;
  }

  async cancel(): Promise<void> {
    return;
  }

  async close(): Promise<void> {
    return;
  }

  isBusy(): boolean {
    return false;
  }

  isAlive(): boolean {
    return true;
  }

  getSessionId(): string {
    return '';
  }

  events(): unknown[] {
    return [];
  }
}
