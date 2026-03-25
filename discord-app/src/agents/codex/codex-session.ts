import { ProcessRunner } from '../base/process-runner.js';
import { readJsonLines } from '../base/jsonl-reader.js';
import type { AgentRuntimeEvent } from '../events.js';
import { createRuntimeErrorEvent } from '../events.js';
import type {
  AgentRuntimeInput,
  AgentSessionRuntime,
  CreateAgentSessionInput,
  RuntimeImageRef,
} from '../types.js';
import { createCodexEventParser } from './codex-event-parser.js';

export class CodexSessionRuntime implements AgentSessionRuntime {
  private currentRunner: ProcessRunner | null = null;
  private readonly parser = createCodexEventParser();
  private readonly pendingEvents: AgentRuntimeEvent[] = [];
  private readonly eventResolvers: Array<(event: AgentRuntimeEvent | null) => void> = [];
  private alive = true;
  private busy = false;
  private terminated = false;
  private sessionId: string;

  constructor(private readonly options: CreateAgentSessionInput) {
    this.sessionId = options.binding.agentSessionId;
  }

  async send(input: AgentRuntimeInput): Promise<void> {
    if (!this.alive) {
      throw new Error('codex runtime is closed');
    }

    const args = this.buildArgs(this.buildPrompt(input), input.images ?? []);
    const runner = ProcessRunner.spawn({
      command: this.options.binding.cliBin || 'codex',
      args,
      cwd: this.options.workDir,
    });

    this.currentRunner = runner;
    this.busy = true;
    this.startReadLoop(runner);
  }

  async cancel(): Promise<void> {
    if (!this.currentRunner) {
      return;
    }
    const runner = this.currentRunner;
    this.currentRunner = null;
    this.busy = false;
    await runner.cancel();
  }

  async close(): Promise<void> {
    if (!this.alive) {
      return;
    }
    this.alive = false;
    this.terminated = true;
    await this.cancel();
    this.resolvePending(null);
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

  private buildPrompt(input: AgentRuntimeInput): string {
    const filePaths = (input.files ?? []).map((file) => file.path).filter((path): path is string => Boolean(path));
    const hasImages = Array.isArray(input.images) && input.images.length > 0;
    let prompt = input.text ?? '';

    if (!prompt && hasImages && filePaths.length === 0) {
      prompt = 'Please analyze the attached image(s).';
    }

    return appendFileRefs(prompt, filePaths);
  }

  private buildArgs(prompt: string, images: RuntimeImageRef[]): string[] {
    const { binding } = this.options;
    const isResume = Boolean(this.sessionId);
    const args: string[] = ['exec'];
    if (isResume) {
      args.push('resume');
    }
    args.push('--skip-git-repo-check');

    switch (binding.mode) {
      case 'auto-edit':
      case 'full-auto':
        args.push('--full-auto');
        break;
      case 'yolo':
        args.push('--dangerously-bypass-approvals-and-sandbox');
        break;
      default:
        break;
    }

    if (binding.model) {
      args.push('--model', binding.model);
    }

    if (binding.reasoningEffort) {
      args.push('-c', `model_reasoning_effort="${binding.reasoningEffort}"`);
    }

    if (isResume) {
      args.push(this.sessionId);
    }

    for (const image of images) {
      args.push('--image', image.path);
    }

    if (isResume) {
      args.push('--json', prompt);
    } else {
      args.push('--json', '--cd', this.options.workDir, prompt);
    }

    return args;
  }

  private startReadLoop(runner: ProcessRunner): void {
    void (async () => {
      try {
        for await (const raw of readJsonLines(runner.stdout)) {
          const events = this.parser.parse(raw);
          for (const event of events) {
            if (event.kind === 'session_init' && event.sessionId) {
              this.sessionId = event.sessionId;
              this.options.binding.agentSessionId = event.sessionId;
            }
            if (event.kind === 'turn_completed' || event.kind === 'turn_failed' || event.kind === 'runtime_error') {
              this.busy = false;
            }
            this.enqueueEvent(event);
          }
        }
      } catch (error) {
        this.enqueueEvent(
          createRuntimeErrorEvent({
            message: error instanceof Error ? error.message : 'codex runtime error',
            runtimeFailureKind: 'runtime_broken',
            raw: error,
          }),
        );
      } finally {
        await runner.waitForExit().catch(() => null);
        this.currentRunner = null;
        this.busy = false;
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
    return new Promise((resolve) => {
      this.eventResolvers.push(resolve);
    });
  }

  private resolvePending(event: AgentRuntimeEvent | null): void {
    while (this.eventResolvers.length > 0) {
      const resolve = this.eventResolvers.shift()!;
      resolve(event);
    }
  }
}

function appendFileRefs(prompt: string, filePaths: string[]): string {
  if (filePaths.length === 0) {
    return prompt;
  }
  const base = prompt || 'Please analyze the attached file(s).';
  return `${base}\n\n(Files saved locally, please read them: ${filePaths.join(', ')})`;
}
