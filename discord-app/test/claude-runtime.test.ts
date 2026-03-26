import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import {
  CLAUDE_CONTINUE_SESSION,
  type ClaudeProcessHandle,
  type ClaudeSessionRuntimeOptions,
  ClaudeSessionRuntime,
} from '../src/agents/claude/claude-session.js';
import { createClaudeAdapter } from '../src/agents/claude/claude-agent.js';
import type { AgentSessionBinding } from '../src/domain/session-binding.js';
import type { AgentRuntimeProjectContext } from '../src/agents/types.js';
import type { ProcessExitResult, ProcessRunnerOptions } from '../src/agents/base/process-runner.js';
import type { AgentRuntimeEvent } from '../src/agents/events.js';

interface FakeProcessRunner extends ClaudeProcessHandle {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  waitForExit: () => Promise<ProcessExitResult>;
  cancel: () => Promise<ProcessExitResult>;
  resolveExit: (result?: ProcessExitResult) => void;
}

function createFakeRunner(): FakeProcessRunner {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let resolved = false;
  let exitResolver: (result: ProcessExitResult) => void;
  const exitPromise = new Promise<ProcessExitResult>((resolve) => {
    exitResolver = resolve;
  });

  const result: ProcessExitResult = { code: 0, signal: null };

  const runner: FakeProcessRunner = {
    stdin,
    stdout,
    stderr,
    waitForExit: () => exitPromise,
    cancel: vi.fn(async () => {
      if (!resolved) {
        resolved = true;
        exitResolver(result);
      }
      return exitPromise;
    }),
    resolveExit(nextResult?: ProcessExitResult) {
      if (!resolved) {
        resolved = true;
        exitResolver(nextResult ?? result);
      }
    },
  };

  return runner;
}

function buildBinding(overrides: Partial<AgentSessionBinding> = {}): AgentSessionBinding {
  const now = new Date().toISOString();
  return {
    id: overrides.id ?? 'binding-id',
    threadRecordId: overrides.threadRecordId ?? 'thread-id',
    agentKind: 'claude',
    agentSessionId: overrides.agentSessionId ?? '',
    runtimeKind: overrides.runtimeKind ?? 'persistent',
    resumeStrategy: overrides.resumeStrategy ?? 'stdio',
    cliBin: overrides.cliBin ?? 'claude',
    model: overrides.model ?? '',
    mode: overrides.mode ?? '',
    reasoningEffort: overrides.reasoningEffort ?? '',
    processState: overrides.processState ?? 'not_started',
    lastSeenAt: overrides.lastSeenAt ?? null,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

function buildProjectContext(overrides: Partial<AgentRuntimeProjectContext> = {}): AgentRuntimeProjectContext {
  return {
    projectId: overrides.projectId ?? 'proj',
    defaultAgent: overrides.defaultAgent ?? 'claude',
    defaultModel: overrides.defaultModel ?? '',
    defaultMode: overrides.defaultMode ?? '',
  };
}

interface RuntimeFixtureOptions {
  bindingOverrides?: Partial<AgentSessionBinding>;
  projectContext?: Partial<AgentRuntimeProjectContext>;
  allowedTools?: string[];
  disallowedTools?: string[];
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  closeTimeoutMs?: number;
  depsClock?: ClaudeSessionRuntimeOptions['deps'] extends { clock?: infer C } ? C : undefined;
}

function createRuntimeFixture(options: RuntimeFixtureOptions = {}) {
  const spawnCalls: ProcessRunnerOptions[] = [];
  const runner = createFakeRunner();
  const runtime = new ClaudeSessionRuntime({
    workDir: '/tmp',
    binding: buildBinding(options.bindingOverrides),
    projectContext: buildProjectContext(options.projectContext ?? {}),
    lastTurn: null,
    allowedTools: options.allowedTools ?? [],
    disallowedTools: options.disallowedTools ?? [],
    env: options.env,
    closeTimeoutMs: options.closeTimeoutMs,
    deps: {
      spawnProcess: (spawnOptions) => {
        spawnCalls.push(spawnOptions);
        return runner;
      },
      clock: options.depsClock,
    },
  });

  return {
    runtime,
    runner,
    spawnOptions: spawnCalls[0],
    spawnCalls,
  };
}

describe('ClaudeSessionRuntime - command construction', () => {
  it('always includes stream-json and permission prompt flags', () => {
    const { spawnOptions } = createRuntimeFixture();
    expect(spawnOptions.command).toBe('claude');
    expect(spawnOptions.args).toEqual(expect.arrayContaining([
      '--output-format',
      'stream-json',
      '--input-format',
      'stream-json',
      '--permission-prompt-tool',
      'stdio',
    ]));
  });

  it('includes continue pair when binding requests continue session', () => {
    const { spawnOptions } = createRuntimeFixture({ bindingOverrides: { agentSessionId: CLAUDE_CONTINUE_SESSION } });
    expect(spawnOptions.args).toEqual(expect.arrayContaining(['--continue', '--fork-session']));
  });

  it('includes resume flag when a specific session id exists', () => {
    const { spawnOptions } = createRuntimeFixture({ bindingOverrides: { agentSessionId: 'session-42' } });
    expect(spawnOptions.args).toEqual(expect.arrayContaining(['--resume', 'session-42']));
  });

  it('appends model, permission mode, and tool filters', () => {
    const { spawnOptions } = createRuntimeFixture({
      bindingOverrides: { model: 'opus', mode: 'auto' },
      allowedTools: ['ToolA', 'ToolB'],
      disallowedTools: ['ToolD'],
    });
    expect(spawnOptions.args).toEqual(expect.arrayContaining(['--model', 'opus']));
    expect(spawnOptions.args).toEqual(expect.arrayContaining(['--permission-mode', 'bypassPermissions']));
    expect(spawnOptions.args).toEqual(expect.arrayContaining(['--allowedTools', 'ToolA,ToolB']));
    expect(spawnOptions.args).toEqual(expect.arrayContaining(['--disallowedTools', 'ToolD']));
  });

  it('filters out CLAUDECODE environment variable', () => {
    const { spawnOptions } = createRuntimeFixture({ env: { CLAUDECODE: '1', PATH: '/tmp' } });
    expect(spawnOptions.env?.CLAUDECODE).toBeUndefined();
    expect(spawnOptions.env?.PATH).toBe('/tmp');
  });

  it('checks the actual configured cli binary', async () => {
    const hasBinary = vi.fn(async () => false);
    const adapter = createClaudeAdapter({ hasBinary });
    await expect(adapter.createSession({
      workDir: '/tmp',
      binding: buildBinding({ cliBin: '/opt/bin/claude-custom' }),
      projectContext: buildProjectContext(),
      lastTurn: null,
    })).rejects.toThrow('/opt/bin/claude-custom CLI not available');
    expect(hasBinary).toHaveBeenCalledWith('/opt/bin/claude-custom');
  });
});

describe('ClaudeSessionRuntime - runtime behaviors', () => {
  it('emits turn_started right after send succeeds', async () => {
    const { runtime, runner } = createRuntimeFixture();
    const iter = runtime.events()[Symbol.asyncIterator]();
    const eventPromise = iter.next();

    await runtime.send({ text: 'hello' });
    const event = await eventPromise;

    expect(event.value?.kind).toBe('turn_started');
    await runner.resolveExit({ code: 0, signal: null });
    await runtime.close();
  });

  it('writes control_response when permission response approved', async () => {
    const { runtime, runner } = createRuntimeFixture();
    const data: string[] = [];
    runner.stdin.on('data', (chunk) => {
      data.push(chunk.toString());
    });

    const permissionPromise = (async () => {
      for await (const event of runtime.events()) {
        if (event.kind === 'permission_request') {
          return event;
        }
      }
    })();

    runner.stdout.write(JSON.stringify({
      type: 'control_request',
      request_id: 'req-1',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'ToolInline',
        input: { question: 'allow?' },
      },
    }) + '\n');

    const permissionEvent = await permissionPromise;
    expect(permissionEvent?.kind).toBe('permission_request');

    await runtime.respondPermission({ requestId: 'req-1', decision: 'approved' });
    expect(data.join('')).toContain('control_response');
    expect(data.join('')).toContain('request_id');

    await runner.resolveExit({ code: 0, signal: null });
    await runtime.close();
  });

  it('does not resolve local permission state if writing control_response fails', async () => {
    const { runtime, runner } = createRuntimeFixture();
    const permissionPromise = (async () => {
      for await (const event of runtime.events()) {
        if (event.kind === 'permission_request') {
          return event;
        }
      }
    })();

    const writeMock = vi.spyOn(runner.stdin, 'write').mockImplementation(((_chunk: any, callback?: any) => {
      if (typeof callback === 'function') {
        callback(new Error('stdin broken'));
      }
      return false;
    }) as typeof runner.stdin.write);
    runner.stdout.write(JSON.stringify({
      type: 'control_request',
      request_id: 'req-2',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'ToolInline',
        input: { question: 'allow?' },
      },
    }) + '\n');

    await permissionPromise;
    await expect(runtime.respondPermission({ requestId: 'req-2', decision: 'approved' })).rejects.toThrow();
    expect(runtime.getPendingPermission()).toEqual(expect.objectContaining({ requestId: 'req-2' }));
    writeMock.mockRestore();
  });

  it('updates session id from session_init events', async () => {
    const { runtime, runner } = createRuntimeFixture();
    runner.stdout.write(JSON.stringify({ type: 'system', session_id: 'session-updated' }) + '\n');
    const iter = runtime.events()[Symbol.asyncIterator]();
    const event = await iter.next();
    expect(event.value?.kind).toBe('session_init');
    expect(runtime.getSessionId()).toBe('session-updated');
    await runner.resolveExit({ code: 0, signal: null });
    await runtime.close();
  });

  it('emits runtime_error on unexpected non-zero exit', async () => {
    const { runtime, runner } = createRuntimeFixture();
    const collected: AgentRuntimeEvent[] = [];
    const collectPromise = (async () => {
      for await (const event of runtime.events()) {
        collected.push(event);
      }
    })();

    runner.stdout.end();
    runner.resolveExit({ code: 2, signal: null });
    await collectPromise;

    expect(collected.some((event) => event.kind === 'runtime_error')).toBe(true);
  });

  it('includes files and images in user payloads', async () => {
    const { runtime, runner } = createRuntimeFixture();
    const chunks: string[] = [];
    runner.stdin.on('data', (chunk) => {
      chunks.push(chunk.toString());
    });

    await runtime.send({
      text: 'describe inputs',
      files: [{ name: 'report.txt', originalName: 'report.txt', path: '/tmp/report.txt' }],
      images: [{ name: 'diagram.png', originalName: 'diagram.png', path: '/tmp/diagram.png', mimeType: 'image/png' }],
    });

    const payload = chunks.join('');
    expect(payload).toContain('"type":"file"');
    expect(payload).toContain('/tmp/report.txt');
    expect(payload).toContain('"type":"image"');
    expect(payload).toContain('/tmp/diagram.png');
    await runner.resolveExit({ code: 0, signal: null });
    await runtime.close();
  });

  it('rejects concurrent send while busy', async () => {
    const { runtime, runner } = createRuntimeFixture();
    await runtime.send({ text: 'first' });
    await expect(runtime.send({ text: 'second' })).rejects.toThrow(/busy/i);
    await runner.resolveExit({ code: 0, signal: null });
    await runtime.close();
  });

  it('forces cancellation when close timeout fires', async () => {
    vi.useFakeTimers();
    try {
      const { runtime, runner } = createRuntimeFixture({ closeTimeoutMs: 1 });
      const closePromise = runtime.close();
      vi.advanceTimersByTime(5);
      await closePromise;
      expect(runner.cancel).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
