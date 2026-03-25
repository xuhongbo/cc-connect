import { describe, expect, it } from 'vitest';

import { createProject } from '../src/domain/project.js';
import { createConversationThread } from '../src/domain/thread.js';
import { createAgentSessionBinding } from '../src/domain/session-binding.js';
import { createAgentsManager } from '../src/agents/manager.js';
import type { AgentSessionRuntime } from '../src/agents/types.js';
import type { AgentRuntimeEvent } from '../src/agents/events.js';
import {
  createTurnCompletedEvent,
  createTurnFailedEvent,
  createRuntimeErrorEvent,
  createThinkingEvent,
} from '../src/agents/events.js';
import { createSessionManager } from '../src/sessions/session-manager.js';
import { handleThreadMessage } from '../src/discord/message-handler.js';
import { createRuntimeEventPump } from '../src/app/runtime-event-pump.js';

class TestRuntime implements AgentSessionRuntime {
  private queue: AgentRuntimeEvent[] = [];
  private waiters: Array<(event: AgentRuntimeEvent | null) => void> = [];
  private closed = false;

  constructor(private readonly failSend = false) {}

  async send(): Promise<void> {
    if (this.failSend) {
      throw new Error('send failed');
    }
  }

  async cancel(): Promise<void> {
    return;
  }

  async close(): Promise<void> {
    this.closed = true;
    while (this.waiters.length) {
      const resolve = this.waiters.shift();
      resolve?.(null);
    }
  }

  isBusy(): boolean {
    return false;
  }

  isAlive(): boolean {
    return true;
  }

  getSessionId(): string {
    return 'test-session';
  }

  getPendingPermission(): null {
    return null;
  }

  async respondPermission(): Promise<void> {
    return;
  }

  async *events(): AsyncGenerator<AgentRuntimeEvent> {
    while (true) {
      const next = await this.dequeueEvent();
      if (!next) {
        break;
      }
      yield next;
    }
  }

  emitEvent(event: AgentRuntimeEvent) {
    if (this.waiters.length > 0) {
      const resolve = this.waiters.shift();
      resolve?.(event);
      return;
    }
    this.queue.push(event);
  }

  private async dequeueEvent(): Promise<AgentRuntimeEvent | null> {
    if (this.queue.length > 0) {
      return this.queue.shift() ?? null;
    }
    if (this.closed) {
      return null;
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

function createProjectContext() {
  return createProject({
    id: 'proj-turns',
    name: 'Turn Project',
    guildId: 'guild',
    channelId: 'channel',
    channelType: 'guildText',
    baseWorkDir: '/tmp/work',
    defaultAgent: 'claude',
    defaultModel: 'sonnet',
    defaultMode: 'default',
  });
}

function createThreadAndBinding(project: ReturnType<typeof createProjectContext>) {
  const thread = createConversationThread({
    id: 'thread-lifecycle',
    projectId: project.id,
    guildId: project.guildId,
    parentChannelId: 'parent',
    threadId: 'thread-id',
    threadTitle: 'Lifecycle Thread',
    threadPrefix: '[Claude]',
    agentKind: project.defaultAgent,
    ownerUserId: 'user',
    createdFrom: 'command',
  });
  const binding = createAgentSessionBinding({
    id: 'binding-lifecycle',
    threadRecordId: thread.id,
    agentKind: thread.agentKind,
    runtimeKind: 'persistent',
    resumeStrategy: 'stdio',
    cliBin: 'claude',
  });
  return { thread, binding };
}

async function flushEvents() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe('thread turn lifecycle', () => {
  it('keeps the thread busy until completion events arrive', async () => {
    const project = createProjectContext();
    const { thread, binding } = createThreadAndBinding(project);
    const sessions = createSessionManager();
    const eventPump = createRuntimeEventPump(sessions);
    const agents = createAgentsManager();
    let runtime: TestRuntime | null = null;

    agents.register({
      kind: 'claude',
      runtimeKind: 'persistent',
      async createSession() {
        runtime = new TestRuntime();
        return runtime;
      },
      async detectAvailability() {
        return true;
      },
    });

    const threadsRepo = {
      async getByThreadId() {
        return thread;
      },
    };

    const bindingsRepo = {
      async getByThreadRecordId() {
        return binding;
      },
    };

    const response = await handleThreadMessage({
      threadId: thread.threadId,
      text: 'Hello',
      project,
      threadsRepo,
      bindingsRepo,
      agents,
      sessions,
      eventPump,
    });

    expect(response.accepted).toBe(true);
    expect(sessions.isBusy(thread.id)).toBe(true);

    const runtimeInstance: TestRuntime = runtime ?? (() => { throw new Error('expected runtime to be created'); })();
    runtimeInstance.emitEvent(createThinkingEvent({ content: 'thinking about it' }));
    await flushEvents();
    expect(sessions.isBusy(thread.id)).toBe(true);

    runtimeInstance.emitEvent(createTurnCompletedEvent({}));
    await flushEvents();
    expect(sessions.isBusy(thread.id)).toBe(false);
  });

  it('does not leave the thread busy when send throws before submission', async () => {
    const project = createProjectContext();
    const { thread, binding } = createThreadAndBinding(project);
    const sessions = createSessionManager();
    const eventPump = createRuntimeEventPump(sessions);
    const agents = createAgentsManager();

    agents.register({
      kind: 'claude',
      runtimeKind: 'persistent',
      async createSession() {
        return new TestRuntime(true);
      },
      async detectAvailability() {
        return true;
      },
    });

    const threadsRepo = {
      async getByThreadId() {
        return thread;
      },
    };

    const bindingsRepo = {
      async getByThreadRecordId() {
        return binding;
      },
    };

    await expect(handleThreadMessage({
      threadId: thread.threadId,
      text: 'Hello',
      project,
      threadsRepo,
      bindingsRepo,
      agents,
      sessions,
      eventPump,
    })).rejects.toThrow('send failed');

    expect(sessions.isBusy(thread.id)).toBe(false);
  });

  it('releases the thread on turn_failed events', async () => {
    const project = createProjectContext();
    const { thread, binding } = createThreadAndBinding(project);
    const sessions = createSessionManager();
    const eventPump = createRuntimeEventPump(sessions);
    const agents = createAgentsManager();
    let runtime: TestRuntime | null = null;

    agents.register({
      kind: 'claude',
      runtimeKind: 'persistent',
      async createSession() {
        runtime = new TestRuntime();
        return runtime;
      },
      async detectAvailability() {
        return true;
      },
    });

    const threadsRepo = {
      async getByThreadId() {
        return thread;
      },
    };

    const bindingsRepo = {
      async getByThreadRecordId() {
        return binding;
      },
    };

    await handleThreadMessage({
      threadId: thread.threadId,
      text: 'Hello',
      project,
      threadsRepo,
      bindingsRepo,
      agents,
      sessions,
      eventPump,
    });

    expect(runtime).not.toBeNull();
    runtime!.emitEvent(createTurnFailedEvent({
      message: 'boom',
      failureKind: 'recoverable_turn_failure',
    }));
    await flushEvents();
    expect(sessions.isBusy(thread.id)).toBe(false);
  });

  it('releases the thread on runtime_error events', async () => {
    const project = createProjectContext();
    const { thread, binding } = createThreadAndBinding(project);
    const sessions = createSessionManager();
    const eventPump = createRuntimeEventPump(sessions);
    const agents = createAgentsManager();
    let runtime: TestRuntime | null = null;

    agents.register({
      kind: 'claude',
      runtimeKind: 'persistent',
      async createSession() {
        runtime = new TestRuntime();
        return runtime;
      },
      async detectAvailability() {
        return true;
      },
    });

    const threadsRepo = {
      async getByThreadId() {
        return thread;
      },
    };

    const bindingsRepo = {
      async getByThreadRecordId() {
        return binding;
      },
    };

    await handleThreadMessage({
      threadId: thread.threadId,
      text: 'Hello',
      project,
      threadsRepo,
      bindingsRepo,
      agents,
      sessions,
      eventPump,
    });

    expect(runtime).not.toBeNull();
    runtime!.emitEvent(createRuntimeErrorEvent({
      message: 'fatal',
      runtimeFailureKind: 'runtime_broken',
    }));
    await flushEvents();
    expect(sessions.isBusy(thread.id)).toBe(false);
  });

  it('releases busy when events stream completes without terminal event', async () => {
    const project = createProjectContext();
    const { thread, binding } = createThreadAndBinding(project);
    const sessions = createSessionManager();
    const eventPump = createRuntimeEventPump(sessions);
    const agents = createAgentsManager();
    let runtime: TestRuntime | null = null;

    agents.register({
      kind: 'claude',
      runtimeKind: 'persistent',
      async createSession() {
        runtime = new TestRuntime();
        return runtime;
      },
      async detectAvailability() {
        return true;
      },
    });

    const threadsRepo = {
      async getByThreadId() {
        return thread;
      },
    };

    const bindingsRepo = {
      async getByThreadRecordId() {
        return binding;
      },
    };

    await handleThreadMessage({
      threadId: thread.threadId,
      text: 'Hello',
      project,
      threadsRepo,
      bindingsRepo,
      agents,
      sessions,
      eventPump,
    });

    expect(runtime).not.toBeNull();
    runtime!.close();
    await flushEvents();
    expect(sessions.isBusy(thread.id)).toBe(false);
  });

  it('ensures only one consumer per thread', () => {
    const sessions = createSessionManager();
    const pump = createRuntimeEventPump(sessions);
    const runtime = new TestRuntime();

    const first = pump.ensurePump('thread-1', runtime);
    const second = pump.ensurePump('thread-1', runtime);

    expect(second).toBe(first);
  });
});
