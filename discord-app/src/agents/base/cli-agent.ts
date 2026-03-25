import type { AgentRuntimeEvent } from '../events.js';
import type {
  AgentSessionRuntime,
  PendingPermissionState,
  PermissionResponseInput,
} from '../types.js';

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

  async respondPermission(_input: PermissionResponseInput): Promise<void> {
    return;
  }

  getPendingPermission(): PendingPermissionState | null {
    return null;
  }

  async *events(): AsyncIterable<AgentRuntimeEvent> {
    return;
  }
}
