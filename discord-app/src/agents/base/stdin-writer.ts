import { Writable } from 'node:stream';

export class StdinWriter {
  private pending: Promise<void> = Promise.resolve();
  private closing = false;
  private closed = false;
  private closePromise: Promise<void> | null = null;

  constructor(private stream: Writable) {
    if (typeof stream.write !== 'function') {
      throw new Error('stdin writer requires a writable stream');
    }
  }

  write(data: string | Buffer): Promise<void> {
    if (this.closed) {
      return Promise.reject(new Error('stdin writer is closed'));
    }
    if (this.closing) {
      return Promise.reject(new Error('stdin writer is closing'));
    }

    const next = this.pending.then(() => this.writeOnce(data));
    this.pending = next.catch(() => undefined);
    return next;
  }

  close(): Promise<void> {
    if (this.closed) {
      return Promise.resolve();
    }
    if (this.closePromise) {
      return this.closePromise;
    }

    this.closing = true;
    const waitForPending = this.pending.catch(() => undefined);

    const closePromise = waitForPending
      .then(
        () =>
          new Promise<void>((resolve, reject) => {
            const onError = (error: Error) => {
              cleanup();
              reject(error);
            };

            const onFinish = () => {
              cleanup();
              resolve();
            };

            const cleanup = () => {
              this.stream.removeListener('error', onError);
              this.stream.removeListener('finish', onFinish);
            };

            this.stream.once('error', onError);
            this.stream.once('finish', onFinish);
            this.stream.end();
          }),
      )
      .then(() => {
        this.closed = true;
        this.closing = false;
      })
      .catch((error) => {
        this.closed = true;
        this.closing = false;
        throw error;
      });

    this.closePromise = closePromise;
    this.pending = closePromise.catch(() => undefined);
    return closePromise;
  }

  private writeOnce(data: string | Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };

      const cleanup = () => {
        this.stream.removeListener('error', onError);
      };

      const done = (error?: Error | null) => {
        if (error) {
          onError(error);
          return;
        }
        cleanup();
        resolve();
      };

      this.stream.on('error', onError);
      this.stream.write(data, done);
    });
  }
}
