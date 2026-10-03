import type { DatabaseService } from './database.service';
import { LibsqlError, type Client, type Transaction } from '@libsql/client';
import { setTimeout } from 'node:timers/promises';

// Retry an entire rolled-back unit, never individual statements within a write.
export async function writeTransaction<T>(
  client: Client,
  work: (tx: Transaction) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    let tx: Transaction | undefined;
    try {
      tx = await client.transaction('write');
      const result = await work(tx);
      await tx.commit();
      return result;
    } catch (error: unknown) {
      if (
        !(error instanceof LibsqlError) ||
        !error.code.startsWith('SQLITE_BUSY') ||
        attempt >= 5
      )
        throw error;
    } finally {
      tx?.close();
    }
    await setTimeout(20 * 2 ** attempt);
  }
}

/** Refresh public reads only after a catalogue transaction has committed. */
export async function writeCatalogTransaction<T>(
  database: DatabaseService,
  work: (tx: Transaction) => Promise<T>,
): Promise<T> {
  const result = await writeTransaction(database.client, work);
  await database.refreshReadReplica?.();
  return result;
}
