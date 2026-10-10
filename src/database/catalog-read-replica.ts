import { createClient, type Client } from '@libsql/client';
import { Logger } from '@nestjs/common';
import { chmodSync, closeSync, mkdirSync, openSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  ReplicaSyncWorker,
  type ReplicaSynchronizer,
} from './replica-sync-worker';

interface ReplicaOptions {
  path: string;
  syncUrl: string;
  authToken?: string;
  syncIntervalMs: number;
}

/** Local catalogue reads; credentials and writes always use the primary client. */
export class CatalogReadReplica {
  private readonly logger = new Logger(CatalogReadReplica.name);
  private readonly replica: ReplicaSynchronizer;
  private readonly url: string;
  private reader?: Client;
  private ready = false;
  private closed = false;
  private pending?: Promise<void>;
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly options: ReplicaOptions,
    private readonly factory: typeof createClient = createClient,
    synchronizer: (
      config: Parameters<typeof createClient>[0],
    ) => ReplicaSynchronizer = (config) => new ReplicaSyncWorker(config),
  ) {
    const path = resolve(options.path);
    const directory = dirname(path);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if ((statSync(directory).mode & 0o077) !== 0) {
      throw new Error(
        'TURSO_REPLICA_PATH requires a private directory (mode 0700)',
      );
    }
    this.url = `file:${path}`;
    // Create the private file before the isolated worker opens it.
    closeSync(openSync(path, 'a', 0o600));
    chmodSync(path, 0o600);
    this.replica = synchronizer({
      url: this.url,
      syncUrl: options.syncUrl,
      authToken: options.authToken,
      readYourWrites: true,
    });
  }

  get client(): Client | undefined {
    return this.ready ? this.reader : undefined;
  }

  async start(): Promise<void> {
    await this.refresh();
    if (this.closed) return;
    this.timer = setInterval(() => {
      if (!this.pending) void this.refresh();
    }, this.options.syncIntervalMs);
    this.timer.unref();
  }

  refresh(): Promise<void> {
    // A refresh after a committed write must run AFTER any background sync.
    // Coalescing it with an older sync could acknowledge a write with stale reads.
    const next = (this.pending ?? Promise.resolve()).then(async () => {
      if (this.closed) return;
      try {
        await this.replica.sync();
        if (this.closed) return;
        // Separate pooled readers allow concurrent read transactions while syncing.
        this.reader ??= this.factory({ url: this.url, timeout: 1000 });
        this.ready = true;
      } catch {
        this.ready = false;
        this.logger.warn(
          'Catalogue replica sync failed; reads use the primary database',
        );
      }
    });
    this.pending = next;
    void next.then(() => {
      if (this.pending === next) this.pending = undefined;
    });
    return next;
  }

  async close(): Promise<void> {
    this.closed = true;
    clearInterval(this.timer);
    await this.replica.close();
    await this.pending;
    this.reader?.close();
    this.ready = false;
  }
}
