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
