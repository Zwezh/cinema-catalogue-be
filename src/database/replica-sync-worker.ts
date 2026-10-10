import { spawn, type ChildProcess } from 'node:child_process';
import type { Config } from '@libsql/client';

export interface ReplicaSynchronizer {
  sync(): Promise<unknown>;
  close(): Promise<void> | void;
}

// libSQL's native embedded sync blocks its calling thread, even though the
// client exposes a Promise. Isolate both opening and syncing from the HTTP loop.
const workerSource = `
let client;
process.on('message', async ({ config, modulePath }) => {
  try {
    client ??= require(modulePath).createClient(config);
    await client.sync();
    process.send('synced');
  } catch {
    process.send('failed');
  }
});
process.on('disconnect', () => {
  client?.close();
  process.exit(0);
});
`;

export class ReplicaSyncWorker implements ReplicaSynchronizer {
  private worker?: ChildProcess;
  private pending?: Promise<void>;
  private closed = false;

  constructor(
    private readonly config: Config,
    private readonly modulePath = require.resolve('@libsql/client'),
    private readonly timeoutMs = 10_000,
  ) {}

  sync(): Promise<void> {
    if (this.closed) return Promise.reject(new Error('Replica worker closed'));
    if (this.pending) return this.pending;
    const worker = (this.worker ??= spawn(
      process.execPath,
      ['-e', workerSource],
      {
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      },
    ));
    const operation = new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (success: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker.off('message', onMessage);
        worker.off('error', onFailure);
        worker.off('exit', onFailure);
        if (success) resolve();
        else {
          if (this.worker === worker) this.worker = undefined;
          worker.kill('SIGKILL');
          reject(new Error('Replica synchronization failed or timed out'));
        }
      };
      const onMessage = (message: unknown) => finish(message === 'synced');
      const onFailure = () => finish(false);
      const timer = setTimeout(onFailure, this.timeoutMs);
      worker.once('message', onMessage);
      worker.once('error', onFailure);
      worker.once('exit', onFailure);
      // Credentials travel over IPC, never process arguments or diagnostic output.
      worker.send(
        { config: this.config, modulePath: this.modulePath },
        (error) => {
          if (error) onFailure();
        },
      );
    });
    this.pending = operation;
    void operation.then(
      () => {
        if (this.pending === operation) this.pending = undefined;
      },
      () => {
        if (this.pending === operation) this.pending = undefined;
      },
    );
    return operation;
  }

  async close(): Promise<void> {
    this.closed = true;
    const worker = this.worker;
    this.worker = undefined;
    worker?.kill('SIGKILL');
    await this.pending?.catch(() => undefined);
  }
}
