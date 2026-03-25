import { PassThrough } from 'node:stream';
import { describe, expect, it, vi, afterEach } from 'vitest';

import { ProcessRunner, type ProcessExitResult } from '../src/agents/base/process-runner.js';
import { createAgentSessionBinding } from '../src/domain/session-binding.js';
import type { AgentSessionBinding } from '../src/domain/session-binding.js';
import { createCodexAdapter } from '../src/agents/codex/codex-agent.js';

interface FakeRunner extends ProcessRunner {
  emitExit(result: ProcessExitResult): void;
}

function createFakeRunner(): FakeRunner {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = new PassThrough();
  let resolved = false;
  let exitResolver: (result: ProcessExitResult) => void = () => {};
  const exitPromise = new Promise<ProcessExitResult>((resolve) => {
    exitResolver = (result) => {
      if (!resolved) {
        resolved = true;
        resolve(result);
      }
    };
  });

  return {
    stdout,
    stderr,
    stdin,
    waitForExit: vi.fn(() => exitPromise),
    cancel: vi.fn(() => {
      exitResolver({ code: null, signal: 'SIGTERM' });
      return exitPromise;
    }),
    emitExit(result: ProcessExitResult) {
      exitResolver(result);
    },
  } as unknown as FakeRunner;
}

const projectContext = {
  projectId: 'project-1',
  defaultAgent: 'codex',
  defaultModel: 'gpt-5-codex',
  defaultMode: 'full-auto',
} as const;

function createBinding(overrides: Partial<AgentSessionBinding> = {}) {
  const binding = createAgentSessionBinding({
    id: 'binding-1',
    threadRecordId: 'thread-1',
    agentKind: 'codex',
    runtimeKind: 'resume-per-turn',
    resumeStrategy: 'resume-id',
    cliBin: 'codex',
    model: 'gpt-5-codex',
    mode: 'suggest',
    reasoningEffort: '',
  });
  return {
    ...binding,
    ...overrides,
  };
}

async function flushAsyncTick() {
  await new Promise((resolve) => setImmediate(resolve));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Codex runtime', () => {
  it('builds exec args for a new turn', async () => {
    const runner = createFakeRunner();
    const spawnSpy = vi.spyOn(ProcessRunner, 'spawn').mockReturnValueOnce(runner as ProcessRunner);

    const adapter = createCodexAdapter({ hasBinary: async () => true });
    const binding = createBinding({
      model: 'o3',
      mode: 'full-auto',
      reasoningEffort: 'high',
    });
    const runtime = await adapter.createSession({
      workDir: '/tmp/workdir',
      binding,
      projectContext,
      lastTurn: null,
    });

    await runtime.send({
      text: 'analyze report',
      files: [{ name: 'report.txt', originalName: 'report.txt', path: '/tmp/workdir/.cc-connect/attachments/report__1_01.txt' }],
      images: [{ name: 'chart.png', originalName: 'chart.png', path: '/tmp/workdir/.cc-connect/images/chart__1_02.png', mimeType: 'image/png' }],
    });

    (runner.stdout as PassThrough).end();
    runner.emitExit({ code: 0, signal: null });
    await flushAsyncTick();

    const options = spawnSpy.mock.calls[0][0];
    expect(options.command).toBe('codex');
    expect(options.cwd).toBe('/tmp/workdir');

    const args = options.args ?? [];
    expect(args).toContain('exec');
    expect(args).toContain('--skip-git-repo-check');
    expect(args).toContain('--full-auto');
    expect(args).toContain('--model');
    expect(args).toContain('o3');
    expect(args).toContain('-c');
    expect(args).toContain('model_reasoning_effort="high"');
    expect(args).toContain('--image');
    expect(args).toContain('/tmp/workdir/.cc-connect/images/chart__1_02.png');
    expect(args).toContain('--json');
    expect(args).toContain('--cd');
    expect(args).toContain('/tmp/workdir');

    expect(args.at(-1)).toContain('analyze report');
    expect(args.at(-1)).toContain('Files saved locally, please read them: /tmp/workdir/.cc-connect/attachments/report__1_01.txt');
  });

  it('reuses thread id for resume turns and honors yolo mode', async () => {
    const firstRunner = createFakeRunner();
    const secondRunner = createFakeRunner();
    const spawnSpy = vi.spyOn(ProcessRunner, 'spawn')
      .mockReturnValueOnce(firstRunner as ProcessRunner)
      .mockReturnValueOnce(secondRunner as ProcessRunner);

    const adapter = createCodexAdapter({ hasBinary: async () => true });
    const binding = createBinding({
      model: 'codex-mini-latest',
      mode: 'yolo',
      reasoningEffort: 'medium',
    });
    const runtime = await adapter.createSession({
      workDir: '/tmp/resume',
      binding,
      projectContext,
      lastTurn: null,
    });

    await runtime.send({ text: 'initial' });

    (firstRunner.stdout as PassThrough).write(JSON.stringify({ type: 'thread.started', thread_id: 'thread-xyz' }) + '\n');
    (firstRunner.stdout as PassThrough).write(JSON.stringify({ type: 'turn.completed' }) + '\n');
    (firstRunner.stdout as PassThrough).end();
    firstRunner.emitExit({ code: 0, signal: null });
    await flushAsyncTick();

    expect(runtime.getSessionId()).toBe('thread-xyz');

    await runtime.send({
      text: 'next prompt',
      images: [{ name: 'photo.png', originalName: 'photo.png', path: '/tmp/resume/.cc-connect/images/photo__1_01.png', mimeType: 'image/png' }],
    });

    (secondRunner.stdout as PassThrough).end();
    secondRunner.emitExit({ code: 0, signal: null });
    await flushAsyncTick();

    const args = spawnSpy.mock.calls[1][0].args ?? [];
    expect(args[0]).toBe('exec');
    expect(args[1]).toBe('resume');
    expect(args).toContain('--skip-git-repo-check');
    expect(args).not.toContain('--cd');
    expect(args).toContain('--dangerously-bypass-approvals-and-sandbox');
    expect(args).toContain('--model');
    expect(args).toContain('codex-mini-latest');
    expect(args).toContain('-c');
    expect(args).toContain('model_reasoning_effort="medium"');

    const tidIndex = args.indexOf('thread-xyz');
    const imageIndex = args.indexOf('--image');
    const jsonIndex = args.indexOf('--json');
    const promptIndex = args.length - 1;
    expect(tidIndex).toBeGreaterThan(-1);
    expect(imageIndex).toBeGreaterThan(tidIndex);
    expect(jsonIndex).toBeGreaterThan(imageIndex + 1);
    expect(promptIndex).toBeGreaterThan(jsonIndex);
    expect(args[promptIndex]).toContain('next prompt');
  });

  it('cancels the running codex process', async () => {
    const runner = createFakeRunner();
    const spawnSpy = vi.spyOn(ProcessRunner, 'spawn').mockReturnValueOnce(runner as ProcessRunner);

    const adapter = createCodexAdapter({ hasBinary: async () => true });
    const binding = createBinding();
    const runtime = await adapter.createSession({
      workDir: '/tmp/cancel',
      binding,
      projectContext,
      lastTurn: null,
    });

    await runtime.send({ text: 'stop me' });
    await runtime.cancel('user abort');

    expect(runner.cancel).toHaveBeenCalled();
    expect(spawnSpy).toHaveBeenCalledTimes(1);
  });
});
