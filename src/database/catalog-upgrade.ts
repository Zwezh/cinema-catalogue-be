import type { Client } from '@libsql/client';
import { writeTransaction } from './transaction';
import { loginAttemptsSchema } from './login-attempts.schema';

export const catalogMigrationIds = [
  'catalog-v3',
  'catalog-v4-provider-index',
  'catalog-v5-page-indexes',
  'catalog-v6-sort-indexes',
  'catalog-v7-refresh-sessions',
  'catalog-v8-wishlist-refresh',
] as const;

export async function upgradeCatalog(client: Client): Promise<void> {
  await writeTransaction(client, async (tx) => {
    const versions = await tx.execute(
      'SELECT id FROM catalog_migrations ORDER BY id',
    );
    if (
      !versions.rows.length ||
      versions.rows.some((row, index) => row.id !== catalogMigrationIds[index])
    )
      throw new Error('Database schema version is newer or incomplete');
    if (versions.rows.length === catalogMigrationIds.length) return;
    if (versions.rows.length < 2) {
      await tx.batch([
        ...loginAttemptsSchema,
        `CREATE INDEX idx_titles_provider_canonical ON titles(CAST(kp_id AS INTEGER))
         WHERE kp_id IS NOT NULL AND trim(kp_id)<>'' AND trim(kp_id) NOT GLOB '*[^0-9]*'`,
        "INSERT INTO catalog_migrations VALUES('catalog-v4-provider-index',strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
      ]);
    }
    if (versions.rows.length < 3) {
      await tx.batch([
        'CREATE INDEX titles_kind_name ON titles(kind, name, id)',
        'CREATE INDEX titles_kind_name_desc ON titles(kind, name DESC, id)',
        "INSERT INTO catalog_migrations VALUES('catalog-v5-page-indexes',strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
      ]);
    }
    if (versions.rows.length < 4) {
      const year = `CASE json_type(year_json)
      WHEN 'array' THEN CAST(json_extract(year_json, '$[0]') AS INTEGER)
      ELSE CAST(year_json AS INTEGER) END`;
      await tx.batch([
        'CREATE INDEX titles_kind_rating ON titles(kind, rating, name, id)',
        'CREATE INDEX titles_kind_rating_desc ON titles(kind, rating DESC, name, id)',
        `CREATE INDEX titles_kind_year ON titles(kind, (${year}), name, id)`,
        `CREATE INDEX titles_kind_year_desc ON titles(kind, (${year}) DESC, name, id)`,
        "INSERT INTO catalog_migrations VALUES('catalog-v6-sort-indexes',strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
      ]);
    }
    if (versions.rows.length < 5) {
      await tx.batch([
        `CREATE TABLE auth_refresh_tokens (token_hash TEXT PRIMARY KEY, session_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES auth_credentials(id) ON DELETE CASCADE, credential_version TEXT NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER, revoked_at INTEGER)`,
        'CREATE INDEX auth_refresh_session ON auth_refresh_tokens(session_id)',
        'CREATE INDEX auth_refresh_expiry ON auth_refresh_tokens(expires_at)',
        "INSERT INTO catalog_migrations VALUES('catalog-v7-refresh-sessions',strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
      ]);
    }
    if (versions.rows.length < 6) {
      await tx.batch([
        'CREATE TABLE title_metadata_revisions (title_id TEXT PRIMARY KEY REFERENCES titles(id) ON DELETE CASCADE, revision INTEGER NOT NULL)',
        `CREATE TRIGGER title_metadata_updated AFTER UPDATE ON titles BEGIN INSERT INTO title_metadata_revisions VALUES(NEW.id,1) ON CONFLICT(title_id) DO UPDATE SET revision=revision+1; END`,
        "INSERT INTO catalog_migrations VALUES('catalog-v8-wishlist-refresh',strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
      ]);
    }
  });
}
