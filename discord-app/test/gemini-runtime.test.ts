import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import { createAgentSessionBinding } from '../src/domain/session-binding.js';
import { createProject } from '../src/domain/project.js';
import type { AgentSessionBinding } from '../src/domain/session-binding.js';
import type { CreateAgentSessionInput } from '../src/agents/types.js';
import type { GeminiSessionRuntimeDeps } from '../src/agents/gemini/gemini-session.js';
import { GeminiSessionRuntime } from '../src/agents/gemini/gemini-session.js';
import { createSessionInitEvent } from '../src/agents/events.js';
import type { AgentRuntimeEvent } from '../src/agents/events.js';

type RuntimeFixtureOptions = {
  bindingOverrides?: Partial<AgentSessionBinding>;
  depsOverrides?: Partial<GeminiSessionRuntimeDeps>;
  timeoutMs?: number;
};

type RuntimeFixture = {
  runtime: GeminiSessionRuntime;
  spawnSpy: ReturnType<typeof vi.fn>;
  scheduleTimeoutSpy: any;
  runner: {
    cancel: ReturnType<typeof vi.fn>;
    stdout: PassThrough;
    stderr: PassThrough;
    stdin: PassThrough;
  };
};

function createRuntimeFixture(options: RuntimeFixtureOptions = {}): RuntimeFixture {
  const binding = {
    ...createAgentSessionBinding({
      id: 'binding-1',
      threadRecordId: 'thread-1',
      agentKind: 'gemini',
      runtimeKind: 'resume-per-turn',
      resumeStrategy: 'resume-id',
      cliBin: 'gemini',
    }),
    ...options.bindingOverrides,
  };

  const project = createProject({
    id: 'project-1',
    name: 'Gemini Project',
    guildId: 'guild-1',
    channelId: 'channel-1',
    channelType: 'guildText',
    baseWorkDir: '/tmp/workdir',
    defaultAgent: 'gemini',
  });

  const input: CreateAgentSessionInput = {
    workDir: '/tmp/workdir',
    binding,
    projectContext: {
      projectId: project.id,
      defaultAgent: project.defaultAgent,
      defaultModel: project.defaultModel,
      defaultMode: project.defaultMode,
    },
    lastTurn: null,
  };

  const runner = createFakeProcessRunner();
  const spawnSpy = vi.fn(() => runner);
  const scheduleTimeoutSpy: any =
    options.depsOverrides?.scheduleTurnTimeout ??
    vi.fn((_timeoutMs: number, _onTimeout: () => void) => ({ cancel: () => {} }));

  const runtime = new GeminiSessionRuntime({
    input,
    timeoutMs: options.timeoutMs,
    deps: {
      spawnProcess: spawnSpy as unknown as NonNullable<GeminiSessionRuntimeDeps['spawnProcess']>,
      readJsonLines: async function* () {},
      createEventParser: () => ({ parse: () => [] }),
      scheduleTurnTimeout: scheduleTimeoutSpy as unknown as NonNullable<GeminiSessionRuntimeDeps['scheduleTurnTimeout']>,
      ...options.depsOverrides,
    },
  });

  return { runtime, spawnSpy, scheduleTimeoutSpy, runner };
}

function createFakeProcessRunner() {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = new PassThrough();
  return {
    stdout,
    stderr,
    stdin,
    waitForExit: vi.fn(() => Promise.resolve({ code: 0, signal: null })),
    cancel: vi.fn(() => Promise.resolve({ code: null, signal: 'SIGTERM' })),
  };
}

type Deferred<T = void> = {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(reason?: unknown): void;
};

function createDeferred<T = void>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('Gemini runtime CLI command', () => {
  it('always requests stream-json output', async () => {
    const { runtime, spawnSpy } = createRuntimeFixture();
    await runtime.send({ text: 'Hello Gemini' });

    const lastCall = spawnSpy.mock.calls[0][0];
    expect(lastCall.args).toContain('--output-format');
    expect(lastCall.args).toContain('stream-json');
  });

  it('adds resume flag when binding has chat id', async () => {
    const { runtime, spawnSpy } = createRuntimeFixture({
      bindingOverrides: { agentSessionId: 'chat-123' },
    });
    await runtime.send({ text: 'resume check' });

    const args = spawnSpy.mock.calls[0][0].args;
    expect(args).toContain('--resume');
    expect(args).toContain('chat-123');
  });

  it('maps mode to approval flags', async () => {
    const modes: Array<[string, string[]]> = [
      ['yolo', ['-y']],
      ['auto_edit', ['--approval-mode', 'auto_edit']],
      ['plan', ['--approval-mode', 'plan']],
    ];

    for (const [mode, expectedTokens] of modes) {
      const { runtime, spawnSpy } = createRuntimeFixture({
        bindingOverrides: { mode },
      });
      await runtime.send({ text: 'mode check' });

      const args = spawnSpy.mock.calls[0][0].args;
      expect(args).toEqual(expect.arrayContaining(expectedTokens));
    }
  });

  it('appends model flag when set', async () => {
    const { runtime, spawnSpy } = createRuntimeFixture({
      bindingOverrides: { model: 'gemini-2.5-pro' },
    });
    await runtime.send({ text: 'model check' });

    const args = spawnSpy.mock.calls[0][0].args;
    expect(args).toContain('-m');
    expect(args).toContain('gemini-2.5-pro');
  });

  it('includes staged attachments in prompt', async () => {
    const { runtime, spawnSpy } = createRuntimeFixture();
    await runtime.send({
      text: 'please read attachments',
      files: [{ name: 'document.txt', path: '/tmp/workdir/doc.txt' }],
      images: [{ name: 'diagram.png', path: '/tmp/workdir/diagram.png', mimeType: 'image/png' }],
    });

    const args = spawnSpy.mock.calls[0][0].args;
    const promptIndex = args.findIndex((arg: string) => arg === '-p');
    expect(promptIndex).toBeGreaterThan(-1);
    const promptValue = args[promptIndex + 1];
    expect(promptValue).toContain('/tmp/workdir/doc.txt');
    expect(promptValue).toContain('/tmp/workdir/diagram.png');
    expect(promptValue).toContain('please read attachments');
  });

  it('retains chat id from session init events for resume', async () => {
    const sessionInitEvent = createSessionInitEvent({ sessionId: 'chat-session-42' });
    const firstSendReady = createDeferred<void>();
    let readCalls = 0;

    const { runtime, spawnSpy } = createRuntimeFixture({
      depsOverrides: {
        readJsonLines: async function* () {
          readCalls += 1;
          if (readCalls === 1) {
            yield sessionInitEvent;
            yield { kind: 'turn_completed', timestamp: new Date().toISOString() };
            firstSendReady.resolve();
            return;
          }
        },
        createEventParser: () => ({
          parse: (raw: AgentRuntimeEvent | AgentRuntimeEvent[]) =>
            Array.isArray(raw) ? raw : [raw],
        }),
      },
    });

    await runtime.send({ text: 'first turn' });
    await firstSendReady.promise;

    await runtime.send({ text: 'second turn' });
    const secondCallArgs = spawnSpy.mock.calls[1][0].args;
    expect(secondCallArgs).toContain('--resume');
    expect(secondCallArgs).toContain('chat-session-42');
  });
});

describe('Gemini runtime timing and cancellation', () => {
  it('schedules configurable timeout per turn', async () => {
    const timeoutMs = 12345;
    const { runtime, scheduleTimeoutSpy } = createRuntimeFixture({ timeoutMs });

    await runtime.send({ text: 'timeout test' });
    expect(scheduleTimeoutSpy).toHaveBeenCalledWith(timeoutMs, expect.any(Function));
  });

  it('cancels the active process when requested', async () => {
    const { runtime, runner } = createRuntimeFixture();
    await runtime.send({ text: 'cancel test' });
    await runtime.cancel();

    expect(runner.cancel).toHaveBeenCalled();
  });

  it('cancels the active process when closed', async () => {
    const { runtime, runner } = createRuntimeFixture();
    await runtime.send({ text: 'close test' });
    await runtime.close();

    expect(runner.cancel).toHaveBeenCalled();
    expect(runtime.isAlive()).toBe(false);
  });

  it('rejects sends after close', async () => {
    const { runtime } = createRuntimeFixture();
    await runtime.close();

    await expect(runtime.send({ text: 'after close' })).rejects.toThrow(/closed/i);
  });

  it('rejects concurrent sends while busy', async () => {
    const { runtime } = createRuntimeFixture();
    await runtime.send({ text: 'first turn' });

    await expect(runtime.send({ text: 'second turn' })).rejects.toThrow(/busy/i);
  });
});
