import type { Client } from '@libsql/client';
import { writeTransaction } from './transaction';
import { loginAttemptsSchema } from './login-attempts.schema';

export const catalogMigrationIds = [
  'catalog-v3',
  'catalog-v4-provider-index',
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
    await tx.batch([
      ...loginAttemptsSchema,
      `CREATE INDEX idx_titles_provider_canonical ON titles(CAST(kp_id AS INTEGER))
       WHERE kp_id IS NOT NULL AND trim(kp_id)<>'' AND trim(kp_id) NOT GLOB '*[^0-9]*'`,
      "INSERT INTO catalog_migrations VALUES('catalog-v4-provider-index',strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
    ]);
  });
}
