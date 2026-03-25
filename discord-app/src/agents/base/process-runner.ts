import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { type Writable } from 'node:stream';

export interface ProcessExitResult {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface ProcessRunnerOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export class ProcessRunner {
  static spawn(options: ProcessRunnerOptions): ProcessRunner {
    const child = spawn(options.command, options.args ?? [], {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return new ProcessRunner(child);
  }

  readonly stdout: NodeJS.ReadableStream;
  readonly stderr: NodeJS.ReadableStream;
  readonly stdin: Writable;

  private exitPromise: Promise<ProcessExitResult>;
  private resolveExit!: (result: ProcessExitResult) => void;
  private rejectExit!: (reason: unknown) => void;
  private settled = false;
  private exitResult: ProcessExitResult | null = null;

  private constructor(private child: ChildProcessWithoutNullStreams) {
    this.stdin = child.stdin;
    this.stdout = child.stdout;
    this.stderr = child.stderr;

    this.exitPromise = new Promise((resolve, reject) => {
      this.resolveExit = resolve;
      this.rejectExit = reject;
    });

    child.once('exit', (code, signal) => {
      if (this.settled) return;
      this.settled = true;
      const result = { code, signal };
      this.exitResult = result;
      this.resolveExit(result);
    });

    child.once('error', (error) => {
      if (this.settled) return;
      this.settled = true;
      this.rejectExit(error);
    });
  }

  waitForExit(): Promise<ProcessExitResult> {
    return this.exitResult ? Promise.resolve(this.exitResult) : this.exitPromise;
  }

  cancel(): Promise<ProcessExitResult> {
    if (!this.child.killed) {
      this.child.kill();
    }

    return this.waitForExit();
  }
}
