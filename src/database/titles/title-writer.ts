import type { Transaction } from '@libsql/client';
import { optionId } from '../schema';
import { TitleConflictError } from '../../shared/titles/title.errors';

export async function assertProviderId(
  tx: Transaction,
  id: string,
  kpId: string | null,
  allowExisting = true,
): Promise<void> {
  if (kpId === null) return;
  const duplicate = await tx.execute({
    sql: "SELECT id FROM titles WHERE kp_id IS NOT NULL AND trim(kp_id)<>'' AND trim(kp_id) NOT GLOB '*[^0-9]*' AND CAST(kp_id AS INTEGER)=CAST(? AS INTEGER) AND id<>? LIMIT 1",
    args: [kpId, id],
  });
  if (duplicate.rows.length) {
    if (!allowExisting) throw new TitleConflictError();
    // A legacy duplicate may keep its original provider ID, but cannot create another.
    const original = await tx.execute({
      sql: 'SELECT kp_id FROM titles WHERE id=?',
      args: [id],
    });
    if (String(original.rows[0]?.kp_id).trim().replace(/^0+/, '') !== kpId)
      throw new TitleConflictError();
  }
}

export async function syncGenres(
  tx: Transaction,
  id: string,
  genres: readonly string[],
): Promise<void> {
  const existing = await tx.execute({
    sql: 'SELECT g.value FROM title_genres tg JOIN genres g ON g.id=tg.genre_id WHERE tg.title_id=?',
    args: [id],
  });
  const before = new Set(existing.rows.map((row) => String(row.value)));
  const after = new Set(genres);
  if (
    before.size === after.size &&
    [...after].every((value) => before.has(value))
  )
    return;
  await tx.execute({
    sql: 'DELETE FROM title_genres WHERE title_id=?',
    args: [id],
  });
  const statements = [...after].flatMap((value) => [
    {
      sql: 'INSERT INTO genres(id,value) VALUES(?,?) ON CONFLICT(value) DO NOTHING',
      args: [optionId('genre', value), value],
    },
    {
      sql: 'INSERT INTO title_genres SELECT ?,id FROM genres WHERE value=?',
      args: [id, value],
    },
  ]);
  if (statements.length) await tx.batch(statements);
}
