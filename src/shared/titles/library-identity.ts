import type { Transaction } from '@libsql/client';
import { randomUUID } from 'node:crypto';
import { TitleConflictError, TitleNotFoundError } from './title.errors';

/** Called inside the primary write transaction, before any library write. */
export async function libraryIdentity(
  tx: Transaction,
  kpId: string | null,
  kind: 'movie' | 'series',
  source?: string,
): Promise<string> {
  const rows =
    kpId === null
      ? []
      : (
          await tx.execute({
            sql: `SELECT t.id,t.kind,EXISTS(SELECT 1 FROM wishlist_entries w WHERE w.title_id=t.id) AS wished,EXISTS(SELECT 1 FROM library_entries l WHERE l.title_id=t.id) AS owned FROM titles t WHERE t.kp_id IS NOT NULL AND trim(t.kp_id)<>'' AND trim(t.kp_id) NOT GLOB '*[^0-9]*' AND CAST(t.kp_id AS INTEGER)=CAST(? AS INTEGER) LIMIT 2`,
            args: [kpId],
          })
        ).rows;
  if (rows.length > 1) throw new TitleConflictError();
  const row = rows[0];
  if (source && !row) throw new TitleNotFoundError();
  if (row) {
    if (
      row.kind !== kind ||
      !row.wished ||
      row.owned ||
      (source && row.id !== source)
    )
      throw new TitleConflictError();
    return String(row.id);
  }
  return randomUUID();
}
