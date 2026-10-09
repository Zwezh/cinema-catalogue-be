import { Injectable } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DatabaseService } from '../../database/database.service';
import { writeTransaction } from '../../database/transaction';

const lifetimeMs = 30 * 24 * 60 * 60 * 1000;
export type RefreshSession = { id: string; token: string; expiresAt: number };
const hash = (token: string): string =>
  createHash('sha256').update(token).digest('hex');
const newToken = (): string => randomBytes(32).toString('base64url');

@Injectable()
export class RefreshSessionRepository {
  constructor(private readonly database: DatabaseService) {}

  async create(userId: string, version: string): Promise<RefreshSession> {
    const session = {
      id: randomUUID(),
      token: newToken(),
      expiresAt: Date.now() + lifetimeMs,
    };
    await this.database.client.batch(
      [
        {
          sql: 'DELETE FROM auth_refresh_tokens WHERE expires_at <= ?',
          args: [Date.now()],
        },
        {
          sql: 'INSERT INTO auth_refresh_tokens VALUES (?,?,?,?,?,NULL,NULL)',
          args: [
            hash(session.token),
            session.id,
            userId,
            version,
            session.expiresAt,
          ],
        },
      ],
      'write',
    );
    return session;
  }

  async rotate(
    token: string,
    userId: string,
    version: string,
  ): Promise<RefreshSession | undefined> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
    return writeTransaction(this.database.client, async (tx) => {
      const result = await tx.execute({
        sql: 'SELECT * FROM auth_refresh_tokens WHERE token_hash=?',
        args: [hash(token)],
      });
      const row = result.rows[0];
      if (!row) return undefined;
      const now = Date.now();
      if (
        row.consumed_at !== null ||
        row.revoked_at !== null ||
        Number(row.expires_at) <= now ||
        row.user_id !== userId ||
        row.credential_version !== version
      ) {
        // Commit family revocation before rejecting replay; throwing inside the transaction would roll it back.
        await tx.execute({
          sql: 'UPDATE auth_refresh_tokens SET revoked_at=? WHERE session_id=?',
          args: [now, row.session_id],
        });
        return undefined;
      }
      const session = {
        id: String(row.session_id),
        token: newToken(),
        expiresAt: Number(row.expires_at),
      };
      await tx.batch([
        {
          sql: 'UPDATE auth_refresh_tokens SET consumed_at=? WHERE token_hash=?',
          args: [now, hash(token)],
        },
        {
          sql: 'INSERT INTO auth_refresh_tokens VALUES (?,?,?,?,?,NULL,NULL)',
          args: [
            hash(session.token),
            session.id,
            userId,
            version,
            session.expiresAt,
          ],
        },
      ]);
      return session;
    });
  }

  async revoke(token: string): Promise<void> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return;
    await this.database.client.execute({
      sql: 'UPDATE auth_refresh_tokens SET revoked_at=? WHERE session_id IN (SELECT session_id FROM auth_refresh_tokens WHERE token_hash=?)',
      args: [Date.now(), hash(token)],
    });
  }

  async isActive(
    id: string,
    userId: string,
    version: string,
  ): Promise<boolean> {
    const result = await this.database.client.execute({
      sql: 'SELECT 1 FROM auth_refresh_tokens WHERE session_id=? AND user_id=? AND credential_version=? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>? LIMIT 1',
      args: [id, userId, version, Date.now()],
    });
    return result.rows.length === 1;
  }
}
