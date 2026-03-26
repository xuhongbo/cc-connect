import { ProcessRunner } from '../base/process-runner.js';
import { readJsonLines } from '../base/jsonl-reader.js';
import type { AgentRuntimeEvent } from '../events.js';
import { createRuntimeErrorEvent, createTurnFailedEvent } from '../events.js';
import type {
  AgentRuntimeInput,
  AgentSessionRuntime,
  CreateAgentSessionInput,
} from '../types.js';
import { createGeminiEventParser } from './gemini-event-parser.js';

export interface GeminiProcessSpawnOptions {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string | undefined>;
}

export interface GeminiProcessHandle {
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  stdin: NodeJS.WritableStream;
  waitForExit(): Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  cancel(): Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

export interface GeminiSessionRuntimeDeps {
  spawnProcess?(options: GeminiProcessSpawnOptions): GeminiProcessHandle;
  readJsonLines?(stream: NodeJS.ReadableStream): AsyncGenerator<unknown>;
  createEventParser?(): ReturnType<typeof createGeminiEventParser>;
  scheduleTurnTimeout?(timeoutMs: number, onTimeout: () => void): { cancel(): void };
}

export interface GeminiSessionRuntimeOptions {
  input: CreateAgentSessionInput;
  timeoutMs?: number;
  deps?: GeminiSessionRuntimeDeps;
}

export class GeminiSessionRuntime implements AgentSessionRuntime {
  private currentRunner: GeminiProcessHandle | null = null;
  private timeoutController: { cancel(): void } | null = null;
  private readonly spawnProcess: (options: GeminiProcessSpawnOptions) => GeminiProcessHandle;
  private readonly readLines: (stream: NodeJS.ReadableStream) => AsyncGenerator<unknown>;
  private readonly parser: ReturnType<typeof createGeminiEventParser>;
  private readonly scheduleTimeout?: GeminiSessionRuntimeDeps['scheduleTurnTimeout'];
  private readonly pendingEvents: AgentRuntimeEvent[] = [];
  private readonly eventResolvers: Array<(event: AgentRuntimeEvent | null) => void> = [];
  private busy = false;
  private alive = true;
  private terminated = false;
  private sessionId: string;

  constructor(private readonly options: GeminiSessionRuntimeOptions) {
    this.parser = (this.options.deps?.createEventParser ?? createGeminiEventParser)();
    this.spawnProcess = this.options.deps?.spawnProcess ?? ProcessRunner.spawn;
    this.readLines = this.options.deps?.readJsonLines ?? readJsonLines;
    this.scheduleTimeout = this.options.deps?.scheduleTurnTimeout;
    this.sessionId = this.options.input.binding.agentSessionId;
  }

  async send(input: AgentRuntimeInput): Promise<void> {
    if (!this.alive) {
      throw new Error('gemini runtime is closed');
    }
    if (this.busy) {
      throw new Error('gemini runtime is busy');
    }
    const command = this.options.input.binding.cliBin || 'gemini';
    const args = this.buildArgs(input);
    const spawnOptions: GeminiProcessSpawnOptions = {
      command,
      args,
      cwd: this.options.input.workDir,
    };

    const runner = this.spawnProcess(spawnOptions);
    this.currentRunner = runner;
    this.busy = true;
    this.timeoutController?.cancel();
    if (this.scheduleTimeout && this.options.timeoutMs && this.options.timeoutMs > 0) {
      this.timeoutController = this.scheduleTimeout(this.options.timeoutMs, () => {
        void this.endTurn('Gemini turn timed out', 'recoverable_turn_failure');
      });
    }

    this.startReadLoop(runner);
  }

  async cancel(): Promise<void> {
    await this.endTurn('Gemini turn cancelled', 'user_cancelled');
  }

  async close(): Promise<void> {
    if (!this.alive) {
      return;
    }
    this.alive = false;
    await this.endTurn(null, null, false);
    this.terminated = true;
    this.resolvePending(null);
  }

  private async endTurn(
    message: string | null,
    failureKind: 'recoverable_turn_failure' | 'user_cancelled' | null,
    emitEvent = true,
  ): Promise<void> {
    if (!this.currentRunner) {
      return;
    }
    const runner = this.currentRunner;
    this.currentRunner = null;
    this.busy = false;
    this.timeoutController?.cancel();
    this.timeoutController = null;
    await runner.cancel();
    if (emitEvent && message && failureKind) {
      this.enqueueEvent(
        createTurnFailedEvent({
          message,
          failureKind,
        }),
      );
    }
  }

  isBusy(): boolean {
    return this.busy;
  }

  isAlive(): boolean {
    return this.alive;
  }

  getSessionId(): string {
    return this.sessionId ?? '';
  }

  getPendingPermission(): null {
    return null;
  }

  async respondPermission(): Promise<void> {
    return;
  }

  async *events(): AsyncIterable<AgentRuntimeEvent> {
    while (!this.terminated) {
      const event = await this.dequeueEvent();
      if (!event) {
        break;
      }
      yield event;
    }
  }

  private buildArgs(input: AgentRuntimeInput): string[] {
    const binding = this.options.input.binding;
    const args: string[] = ['--output-format', 'stream-json'];

    switch (binding.mode) {
      case 'yolo':
        args.push('-y');
        break;
      case 'auto_edit':
        args.push('--approval-mode', 'auto_edit');
        break;
      case 'plan':
        args.push('--approval-mode', 'plan');
        break;
      default:
        break;
    }

    if (binding.agentSessionId) {
      args.push('--resume', binding.agentSessionId);
    }

    if (binding.model) {
      args.push('-m', binding.model);
    }

    const attachmentPaths = [
      ...(input.images ?? []).map((image) => image.path),
      ...(input.files ?? []).map((file) => file.path),
    ];

    const promptParts = [...attachmentPaths];
    if (input.text) {
      promptParts.push(input.text);
    }

    const prompt = promptParts.join(' ');
    args.push('-p', prompt);

    return args;
  }

  private startReadLoop(runner: GeminiProcessHandle): void {
    void (async () => {
      try {
        for await (const raw of this.readLines(runner.stdout)) {
          const events = this.parser.parse(raw);
          for (const event of events) {
            if (event.kind === 'session_init' && 'sessionId' in event) {
              this.sessionId = event.sessionId;
              this.options.input.binding.agentSessionId = event.sessionId;
            }
            if (event.kind === 'turn_completed' || event.kind === 'turn_failed' || event.kind === 'runtime_error') {
              this.busy = false;
              this.timeoutController?.cancel();
              this.timeoutController = null;
            }
            this.enqueueEvent(event);
          }
        }
      } catch (error) {
        this.enqueueEvent(
          createRuntimeErrorEvent({
            message: error instanceof Error ? error.message : 'gemini runtime error',
            runtimeFailureKind: 'runtime_broken',
            raw: error,
          }),
        );
      } finally {
        await runner
          .waitForExit()
          .catch(() => undefined)
          .finally(() => {
            this.cleanupRunner();
          });
      }
    })();
  }

  private enqueueEvent(event: AgentRuntimeEvent): void {
    if (this.eventResolvers.length > 0) {
      const resolve = this.eventResolvers.shift()!;
      resolve(event);
      return;
    }
    this.pendingEvents.push(event);
  }

  private dequeueEvent(): Promise<AgentRuntimeEvent | null> {
    if (this.pendingEvents.length > 0) {
      return Promise.resolve(this.pendingEvents.shift()!);
    }

    if (this.terminated) {
      return Promise.resolve(null);
    }

    return new Promise<AgentRuntimeEvent | null>((resolve) => {
      this.eventResolvers.push(resolve);
    });
  }

  private resolvePending(value: AgentRuntimeEvent | null): void {
    while (this.eventResolvers.length > 0) {
      const resolve = this.eventResolvers.shift()!;
      resolve(value);
    }
  }

  private cleanupRunner(): void {
    this.currentRunner = null;
    this.busy = false;
    this.timeoutController?.cancel();
    this.timeoutController = null;
  }
}
