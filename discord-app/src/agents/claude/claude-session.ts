import type { Writable } from 'node:stream';
import { readJsonLines } from '../base/jsonl-reader.js';
import { ProcessRunner, type ProcessExitResult, type ProcessRunnerOptions } from '../base/process-runner.js';
import { StdinWriter } from '../base/stdin-writer.js';
import type { AgentRuntimeEvent, PermissionResolutionDecision } from '../events.js';
import {
  createPermissionRequestEvent,
  createPermissionResolvedEvent,
  createRuntimeErrorEvent,
  createTurnStartedEvent,
} from '../events.js';
import type {
  AgentRuntimeInput,
  AgentRuntimeProjectContext,
  AgentSessionRuntime,
  PermissionResponseInput,
  PendingPermissionState,
} from '../types.js';
import type { AgentSessionBinding } from '../../domain/session-binding.js';
import type { LastTurnSnapshot } from '../../domain/last-turn.js';
import { ClaudeEventParser, type ClaudePermissionTransition } from './claude-event-parser.js';
import { ClaudePermissionState } from './claude-permission-state.js';

const CLAUDE_CONTINUE_SESSION = '__continue__';
const DEFAULT_CLOSE_TIMEOUT_MS = 8_000;

export interface ClaudeProcessHandle {
  stdin: Writable;
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  waitForExit(): Promise<ProcessExitResult>;
  cancel(): Promise<ProcessExitResult>;
}

interface InternalClock {
  now(): string;
}

interface AsyncEventQueue<T> extends AsyncIterableIterator<T> {
  push(value: T): void;
  close(): void;
}

class EventQueue<T> implements AsyncEventQueue<T> {
  #values: T[] = [];
  #resolvers: Array<(value: IteratorResult<T>) => void> = [];
  #closed = false;

  push(value: T): void {
    if (this.#closed) {
      return;
    }
    if (this.#resolvers.length > 0) {
      const resolve = this.#resolvers.shift();
      resolve?.({ value, done: false });
      return;
    }
    this.#values.push(value);
  }

  close(): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    for (const resolve of this.#resolvers) {
      resolve({ value: undefined as unknown as T, done: true });
    }
    this.#resolvers = [];
  }

  [Symbol.asyncIterator](): AsyncEventQueue<T> {
    return this;
  }

  next(): Promise<IteratorResult<T>> {
    if (this.#values.length > 0) {
      const value = this.#values.shift()!;
      return Promise.resolve({ value, done: false });
    }
    if (this.#closed) {
      return Promise.resolve({ value: undefined as unknown as T, done: true });
    }
    return new Promise<IteratorResult<T>>((resolve) => {
      this.#resolvers.push(resolve);
    });
  }
}

export interface ClaudeSessionRuntimeDeps {
  spawnProcess(options: ProcessRunnerOptions): ClaudeProcessHandle;
  clock?: InternalClock;
}

export interface ClaudeSessionRuntimeOptions {
  workDir: string;
  binding: AgentSessionBinding;
  projectContext: AgentRuntimeProjectContext;
  lastTurn?: LastTurnSnapshot | null;
  allowedTools?: string[];
  disallowedTools?: string[];
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  closeTimeoutMs?: number;
  deps?: ClaudeSessionRuntimeDeps;
}

export class ClaudeSessionRuntime implements AgentSessionRuntime {
  public static readonly CONTINUE_SESSION = CLAUDE_CONTINUE_SESSION;

  readonly #workDir: string;
  readonly #binding: AgentSessionBinding;
  readonly #projectContext: AgentRuntimeProjectContext;
  readonly #allowedTools: string[];
  readonly #disallowedTools: string[];
  readonly #deps: ClaudeSessionRuntimeDeps;
  readonly #parser: ClaudeEventParser;
  readonly #permissionState: ClaudePermissionState;
  readonly #eventQueue = new EventQueue<AgentRuntimeEvent>();
  readonly #runner: ClaudeProcessHandle;
  readonly #stdinWriter: StdinWriter;
  readonly #lastTurn: LastTurnSnapshot | null;

  #sessionId = '';
  #busy = false;
  #alive = true;
  #closing = false;
  #closePromise: Promise<void> | null = null;
  #closeTimer: ReturnType<typeof setTimeout> | null = null;
  #closeTimeoutMs: number;

  constructor(options: ClaudeSessionRuntimeOptions) {
    this.#workDir = options.workDir;
    this.#binding = options.binding;
    this.#projectContext = options.projectContext;
    this.#allowedTools = options.allowedTools ?? [];
    this.#disallowedTools = options.disallowedTools ?? [];
    this.#deps = options.deps ?? { spawnProcess: ProcessRunner.spawn };
    this.#closeTimeoutMs = options.closeTimeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS;
    this.#lastTurn = options.lastTurn ?? null;

    const clock: InternalClock = this.#deps.clock ?? { now: () => new Date().toISOString() };
    this.#parser = new ClaudeEventParser({ clock });

    this.#permissionState = new ClaudePermissionState({
      clock,
      onResolution: (resolution) => this.#handlePermissionResolution(resolution),
    });

    this.#sessionId = this.#deriveInitialSessionId();

    const spawnOptions: ProcessRunnerOptions = {
      command: this.#binding.cliBin || 'claude',
      args: this.#buildArgs(),
      cwd: this.#workDir,
      env: this.#buildEnv(options.env),
    };

    this.#runner = this.#deps.spawnProcess(spawnOptions);
    this.#stdinWriter = new StdinWriter(this.#runner.stdin);

    void this.#startReadLoop();
  }

  events(): AsyncIterable<AgentRuntimeEvent> {
    return this.#eventQueue;
  }

  async send(input: AgentRuntimeInput): Promise<void> {
    if (!this.#alive) {
      throw new Error('Claude runtime is not running');
    }
    if (this.#busy) {
      throw new Error('Claude runtime is busy');
    }
    const payload = this.#buildUserPayload(input);
    await this.#stdinWriter.write(`${JSON.stringify(payload)}\n`);
    this.#busy = true;
    this.#enqueueEvent(createTurnStartedEvent({ sessionId: this.#sessionId || undefined }));
  }

  async cancel(): Promise<void> {
    if (!this.#alive) {
      return;
    }
    this.#closing = true;
    this.#busy = false;
    await this.#runner.cancel().catch(() => undefined);
  }

  async close(): Promise<void> {
    if (this.#closePromise) {
      return this.#closePromise;
    }
    this.#closePromise = (async () => {
      this.#closing = true;
      if (this.#closeTimeoutMs >= 0) {
        this.#closeTimer = setTimeout(() => {
          void this.#runner.cancel();
        }, this.#closeTimeoutMs);
      }
      try {
        await this.#runner.waitForExit().catch(() => undefined);
      } finally {
        if (this.#closeTimer) {
          clearTimeout(this.#closeTimer);
          this.#closeTimer = null;
        }
        this.#alive = false;
      }
    })();
    return this.#closePromise;
  }

  isBusy(): boolean {
    return this.#busy;
  }

  isAlive(): boolean {
    return this.#alive;
  }

  getSessionId(): string {
    return this.#sessionId;
  }

  getPendingPermission(): PendingPermissionState | null {
    return this.#permissionState.getPendingPermission();
  }

  async respondPermission(input: PermissionResponseInput): Promise<void> {
    const pending = this.#permissionState.getPendingPermission();
    if (!pending || pending.requestId !== input.requestId) {
      throw new Error(`No pending permission for request ${input.requestId}`);
    }
    const behavior = input.decision === 'approved' ? 'allow' : 'deny';
    const controlResponse = {
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: input.requestId,
        response: {
          behavior,
        },
      },
    } as const;
    await this.#stdinWriter.write(`${JSON.stringify(controlResponse)}\n`);
    const resolution = this.#permissionState.respond(input);
    if (!resolution) {
      throw new Error(`Failed to resolve permission for request ${input.requestId}`);
    }
  }

  #enqueueEvent(event: AgentRuntimeEvent) {
    this.#eventQueue.push(event);
  }

  #buildParts(input: AgentRuntimeInput): unknown[] {
    const parts: unknown[] = [];
    if (input.text) {
      parts.push({ type: 'text', text: input.text });
    }
    for (const file of input.files ?? []) {
      parts.push({ type: 'file', path: file.path, name: file.name });
    }
    for (const image of input.images ?? []) {
      parts.push({ type: 'image', path: image.path, name: image.name, mimeType: image.mimeType });
    }
    if (parts.length === 0) {
      parts.push({ type: 'text', text: '' });
    }
    return parts;
  }

  #buildUserPayload(input: AgentRuntimeInput) {
    return {
      type: 'user',
      message: {
        role: 'user',
        content: this.#buildParts(input),
      },
    };
  }

  #buildArgs(): string[] {
    const args = [
      '--output-format',
      'stream-json',
      '--input-format',
      'stream-json',
      '--permission-prompt-tool',
      'stdio',
    ];

    const mode = normalizePermissionMode(
      this.#binding.mode || this.#projectContext.defaultMode || '',
    );

    if (mode && mode !== 'default') {
      args.push('--permission-mode', mode);
    }

    const model = this.#binding.model || this.#projectContext.defaultModel;
    if (model) {
      args.push('--model', model);
    }

    if (this.#binding.agentSessionId === CLAUDE_CONTINUE_SESSION) {
      args.push('--continue', '--fork-session');
    } else if (this.#binding.agentSessionId) {
      args.push('--resume', this.#binding.agentSessionId);
    }

    if (this.#allowedTools.length > 0) {
      args.push('--allowedTools', this.#allowedTools.join(','));
    }
    if (this.#disallowedTools.length > 0) {
      args.push('--disallowedTools', this.#disallowedTools.join(','));
    }

    return args;
  }

  #buildEnv(override?: NodeJS.ProcessEnv | Record<string, string | undefined>): NodeJS.ProcessEnv {
    const base: NodeJS.ProcessEnv = { ...process.env };
    if (override) {
      for (const [key, value] of Object.entries(override)) {
        if (value === undefined) {
          delete base[key];
        } else {
          base[key] = value;
        }
      }
    }
    delete base.CLAUDECODE;
    return base;
  }

  #deriveInitialSessionId(): string {
    const sessionId = this.#binding.agentSessionId;
    if (sessionId && sessionId !== CLAUDE_CONTINUE_SESSION) {
      return sessionId;
    }
    return '';
  }

  async #startReadLoop(): Promise<void> {
    let readError: unknown;
    try {
      for await (const raw of readJsonLines(this.#runner.stdout)) {
        this.#handleParserResult(this.#parser.parse(raw));
      }
    } catch (error) {
      readError = error;
      this.#enqueueEvent(
        createRuntimeErrorEvent({
          message: error instanceof Error ? error.message : 'Claude runtime read error',
          runtimeFailureKind: 'runtime_broken',
        }),
      );
    } finally {
      try {
        const exitResult = await this.#runner.waitForExit().catch((error) => {
          if (!this.#closing) {
            this.#enqueueEvent(
              createRuntimeErrorEvent({
                message: error instanceof Error ? error.message : 'Claude runtime exit error',
                runtimeFailureKind: 'runtime_broken',
                raw: error,
              }),
            );
          }
          return null;
        });

        if (!this.#closing && !readError && exitResult && (exitResult.code !== 0 || exitResult.signal)) {
          this.#enqueueEvent(
            createRuntimeErrorEvent({
              message: `Claude process exited unexpectedly (code=${exitResult.code}, signal=${exitResult.signal ?? 'none'})`,
              runtimeFailureKind: 'runtime_broken',
              raw: exitResult,
            }),
          );
        }
      } finally {
        this.#alive = false;
        this.#busy = false;
        this.#eventQueue.close();
      }
    }
  }

  #handleParserResult(result: { events: AgentRuntimeEvent[]; permissionTransition?: ClaudePermissionTransition }) {
    for (const event of result.events) {
      this.#handleEvent(event);
      this.#enqueueEvent(event);
    }
    if (result.permissionTransition) {
      this.#handlePermissionTransition(result.permissionTransition);
    }
  }

  #handleEvent(event: AgentRuntimeEvent) {
    if (event.kind === 'session_init' && event.sessionId) {
      this.#sessionId = event.sessionId;
    }
    if (event.kind === 'turn_completed' || event.kind === 'turn_failed' || event.kind === 'runtime_error') {
      this.#busy = false;
    }
  }

  #handlePermissionTransition(transition: ClaudePermissionTransition) {
    switch (transition.type) {
      case 'start': {
        const pending = this.#permissionState.startRequest(
          transition.request,
        );
        if (!pending) {
          return;
        }
        this.#enqueueEvent(
          createPermissionRequestEvent({
            requestId: pending.requestId,
            toolName: pending.toolName,
            toolInput: pending.toolInput,
            toolCallId: pending.toolCallId,
          }),
        );
        break;
      }
      case 'cancel': {
        this.#permissionState.cancel(transition.requestId);
        break;
      }
    }
  }

  #handlePermissionResolution(resolution: { requestId: string; decision: PermissionResolutionDecision; resolvedAt: string }) {
    this.#parser.releasePendingPermission(resolution.requestId);
    this.#enqueueEvent(
      createPermissionResolvedEvent({
        requestId: resolution.requestId,
        decision: resolution.decision,
      }),
    );
  }
}

function normalizePermissionMode(raw: string): string {
  switch (raw.trim().toLowerCase()) {
    case 'acceptedits':
    case 'accept-edits':
    case 'accept_edits':
    case 'edit':
      return 'acceptEdits';
    case 'plan':
      return 'plan';
    case 'bypasspermissions':
    case 'bypass-permissions':
    case 'bypass_permissions':
    case 'yolo':
    case 'auto':
      return 'bypassPermissions';
    case 'dontask':
    case 'dont-ask':
    case 'dont_ask':
      return 'dontAsk';
    case 'default':
    case '':
      return 'default';
    default:
      return 'default';
  }
}

export { CLAUDE_CONTINUE_SESSION };
