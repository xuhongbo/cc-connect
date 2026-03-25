import { PassThrough, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { ProcessRunner } from '../src/agents/base/process-runner.js';
import { StdinWriter } from '../src/agents/base/stdin-writer.js';
import { readJsonLines } from '../src/agents/base/jsonl-reader.js';

function collectStream(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    stream.on('data', (chunk) => {
      data += chunk.toString('utf8');
    });
    stream.on('end', () => resolve(data));
    stream.on('error', reject);
  });
}

describe('process runner', () => {
  it('captures stdout and stderr from spawned process', async () => {
    const runner = ProcessRunner.spawn({
      command: process.execPath,
      args: ['-e', 'console.log("hello stdout"); console.error("hello stderr");'],
    });

    const stdout = collectStream(runner.stdout);
    const stderr = collectStream(runner.stderr);

    const exit = await runner.waitForExit();

    expect(exit.code).toBe(0);
    expect(await stdout).toContain('hello stdout');
    expect(await stderr).toContain('hello stderr');
  });

  it('allows cancelling a long running process', async () => {
    const runner = ProcessRunner.spawn({
      command: process.execPath,
      args: ['-e', 'setTimeout(() => console.log("done"), 500);'],
    });

    const exitPromise = runner.waitForExit();
    const cancelResult = await runner.cancel();

    expect(cancelResult.signal).not.toBeNull();
    await expect(exitPromise).resolves.toEqual(cancelResult);
  });
});

describe('jsonl reader', () => {
  it('yields parsed JSON objects line by line', async () => {
    const stream = new PassThrough();
    const collected: unknown[] = [];

    const readerPromise = (async () => {
      for await (const entry of readJsonLines(stream)) {
        collected.push(entry);
      }
    })();

    stream.write(JSON.stringify({ foo: 'bar' }) + '\n');
    stream.write(JSON.stringify({ value: 42 }) + '\n');
    stream.end();

    await readerPromise;

    expect(collected).toEqual([
      { foo: 'bar' },
      { value: 42 },
    ]);
  });
});

describe('stdin writer', () => {
  it('writes serialized data to the underlying stream', async () => {
    const runner = ProcessRunner.spawn({
      command: process.execPath,
      args: [
        '-e',
        `
const buffer = [];
process.stdin.on('data', (chunk) => {
  buffer.push(chunk.toString());
});
process.stdin.on('end', () => {
  console.log(buffer.join(''));
  process.exit(0);
});
        `,
      ],
    });

    const writer = new StdinWriter(runner.stdin);
    await writer.write('ping ');
    await writer.write('pong');
    writer.close();

    const stdout = await collectStream(runner.stdout);
    expect(stdout.trim()).toBe('ping pong');
  });

  it('queues writes until previous write drains', async () => {
    const writeCalls: string[] = [];
    const callbacks: Array<() => void> = [];

    const fakeStream = new Writable({
      write(chunk, _encoding, callback) {
        writeCalls.push(chunk.toString());
        callbacks.push(() => {
          callback();
        });
        return false;
      },
    });

    const writer = new StdinWriter(fakeStream);

    const firstWrite = writer.write('first');
    const secondWrite = writer.write('second');

    await Promise.resolve();

    expect(writeCalls).toEqual(['first']);
    expect(callbacks).toHaveLength(1);

    callbacks[0]();
    await firstWrite;

    await Promise.resolve();
    expect(callbacks).toHaveLength(2);

    callbacks[1]();
    await secondWrite;
  });

  it('waits for queued writes before ending when close is called mid-stream', async () => {
    class ControlledWritable extends Writable {
      public writeCalls: string[] = [];
      public endCalled = false;
      private pendingCallbacks: Array<() => void> = [];

      constructor() {
        super();
      }

      _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
        this.writeCalls.push(chunk.toString());
        this.pendingCallbacks.push(() => {
          callback();
        });
        return false;
      }

      triggerNext() {
        const next = this.pendingCallbacks.shift();
        if (next) {
          next();
        }
      }

      end(cb?: () => void): this {
        this.endCalled = true;
        super.end(cb);
        return this;
      }
    }

    const sink = new ControlledWritable();
    const writer = new StdinWriter(sink);

    const first = writer.write('first');
    const second = writer.write('second');
    const closePromise = writer.close();

    expect(sink.endCalled).toBe(false);

    await Promise.resolve();

    sink.triggerNext();
    await first;

    expect(sink.endCalled).toBe(false);

    await Promise.resolve();

    sink.triggerNext();
    await second;

    await closePromise;

    expect(sink.endCalled).toBe(true);
    expect(sink.writeCalls).toEqual(['first', 'second']);
  });
});
