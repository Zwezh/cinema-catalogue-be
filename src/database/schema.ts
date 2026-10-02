import { catalogMigrationIds, upgradeCatalog } from './catalog-upgrade';
import type { Client, InStatement } from '@libsql/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeSearch } from './search';
import { storedStringArray } from './json';
import { initializeDatabase as initializeLegacy } from './legacy-schema';
export { defaultQuality, defaultExtensions } from './legacy-schema';
export type {
  QualityOptionRecord,
  ExtensionOptionRecord,
} from './legacy-schema';
import type {
  QualityOptionRecord,
  ExtensionOptionRecord,
} from './legacy-schema';

export const databaseSchemaVersion = 4;
export const settingsId = 'settings:default';
export { optionId } from '../shared/titles/catalog-options';
import { optionId } from '../shared/titles/catalog-options';

export function replaceCatalogStatements(
  quality: readonly QualityOptionRecord[],
  extensions: readonly ExtensionOptionRecord[],
): InStatement[] {
  return [
    'DELETE FROM settings_qualities',
    'DELETE FROM settings_extensions',
    'UPDATE qualities SET is_active = 0',
    'UPDATE extensions SET is_active = 0',
    ...quality.flatMap((q, i): InStatement[] => [
      {
        sql: `INSERT INTO qualities(id,value,title,is_active) VALUES(?,?,?,1)
        ON CONFLICT(value) DO UPDATE SET title=excluded.title, is_active=1`,
        args: [optionId('quality', q.value), q.value, q.title],
      },
      {
        sql: `INSERT INTO settings_qualities SELECT ?,id,?,? FROM qualities WHERE value=?`,
        args: [settingsId, Number(q.default === true), i, q.value],
      },
    ]),
    ...extensions.flatMap((e, i): InStatement[] => [
      {
        sql: `INSERT INTO extensions(id,value,is_active) VALUES(?,?,1)
        ON CONFLICT(value) DO UPDATE SET is_active=1`,
        args: [optionId('extension', e.value), e.value],
      },
      {
        sql: `INSERT INTO settings_extensions SELECT ?,id,?,? FROM extensions WHERE value=?`,
        args: [settingsId, Number(e.default === true), i, e.value],
      },
    ]),
  ];
}

export async function initializeDatabase(client: Client): Promise<void> {
  await client.execute('PRAGMA foreign_keys = ON');
  const ledger = await client.execute(
    "SELECT 1 FROM sqlite_master WHERE name='catalog_migrations' AND type='table'",
  );
  if (ledger.rows.length) {
    const ids = await client.execute(
      'SELECT id FROM catalog_migrations ORDER BY id',
    );
    if (
      !ids.rows.length ||
      ids.rows.some((row, index) => row.id !== catalogMigrationIds[index])
    )
      throw new Error('Database schema version is newer or incomplete');
    const view = await client.execute(
      "SELECT 1 FROM sqlite_master WHERE type='view' AND name='movie_catalog'",
    );
    if (!view.rows.length) await integrateStandalone(client);
    await upgradeCatalog(client);
    await assertDatabaseVersion(client);
    return;
  }
  // Existing legacy settings/search upgrades remain supported before the v3 copy.
  await initializeLegacy(client);
  const tx = await client.transaction('write');
  try {
    const locked = await tx.execute(
      "SELECT 1 FROM sqlite_master WHERE name='catalog_migrations' AND type='table'",
    );
    if (locked.rows.length) {
      await tx.commit();
      await upgradeCatalog(client);
      await assertDatabaseVersion(client);
      return;
    }
    const invalid = await tx.execute(
      'SELECT id FROM movies WHERE is_series IS NOT NULL AND is_series NOT IN (0,1) LIMIT 1',
    );
    if (invalid.rows.length)
      throw new Error('Invalid legacy is_series; migration aborted');
    await tx.executeMultiple(
      readFileSync(resolve(__dirname, '../../database-v3/schema.sql'), 'utf8'),
    );
    await tx.executeMultiple(
      readFileSync(resolve(__dirname, '../../database-v3/migrate.sql'), 'utf8'),
    );
    const movies = await tx.execute(
      'SELECT id,name,actors_json,director_json FROM movies',
    );
    for (const m of movies.rows) {
      await tx.execute({
        sql: `UPDATE titles SET name_search=?,actors_search_json=?,director_search_json=? WHERE id=?`,
        args: [
          normalizeSearch(String(m.name)),
          JSON.stringify(
            storedStringArray(m.actors_json, 'actors_json').map(
              normalizeSearch,
            ),
          ),
          JSON.stringify(
            storedStringArray(m.director_json, 'director_json').map(
              normalizeSearch,
            ),
          ),
          String(m.id),
        ],
      });
    }
    const count = await tx.execute(
      'SELECT (SELECT COUNT(*) FROM movies) AS source,(SELECT COUNT(*) FROM titles) AS target',
    );
    if (count.rows[0].source !== count.rows[0].target)
      throw new Error('Migration row count mismatch');
    if ((await tx.execute('PRAGMA foreign_key_check')).rows.length)
      throw new Error('Migration foreign key check failed');
    await tx.execute(
      "INSERT INTO schema_migrations VALUES(3,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
    );
    // Archive source tables with their exact columns and indexes. They are snapshots.
    for (const table of [
      'movies',
      'settings',
      'quality_options',
      'extension_options',
      'auth',
    ]) {
      await tx.execute(`ALTER TABLE ${table} RENAME TO legacy_v2_${table}`);
    }
    await tx.executeMultiple(movieViewSql);
    await tx.commit();
  } finally {
    tx.close();
  }
  await upgradeCatalog(client);
  await assertDatabaseVersion(client);
}

async function integrateStandalone(client: Client): Promise<void> {
  const tx = await client.transaction('write');
  try {
    const view = await tx.execute(
      "SELECT 1 FROM sqlite_master WHERE type='view' AND name='movie_catalog'",
    );
    if (!view.rows.length) {
      for (const table of [
        'movies',
        'settings',
        'quality_options',
        'extension_options',
        'auth',
      ]) {
        await tx.execute(`ALTER TABLE ${table} RENAME TO legacy_v2_${table}`);
      }
      await tx.executeMultiple(movieViewSql);
    }
    await tx.commit();
  } finally {
    tx.close();
  }
}

export async function assertDatabaseVersion(client: Client): Promise<void> {
  const exists = await client.execute(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='catalog_migrations'",
  );
  if (!exists.rows.length)
    throw new Error('Database migrations are required; run npm run migrate');
  const ids = await client.execute(
    'SELECT id FROM catalog_migrations ORDER BY id',
  );
  if (
    ids.rows.length !== catalogMigrationIds.length ||
    ids.rows.some((row, index) => row.id !== catalogMigrationIds[index])
  )
    throw new Error('Database schema version is newer or incomplete');
  const required = await client.execute(
    "SELECT name FROM sqlite_master WHERE name IN ('idx_titles_provider_canonical','login_attempts','idx_login_attempts_expiration')",
  );
  if (required.rows.length !== 3)
    throw new Error(
      'Database schema version is incomplete; run the matching migrations',
    );
  const view = await client.execute(
    "SELECT 1 FROM sqlite_master WHERE type='view' AND name='movie_catalog'",
  );
  if (!view.rows.length)
    throw new Error(
      'Database schema version is incomplete; standalone v3 package requires backend integration',
    );
}

const movieViewSql = `CREATE VIEW movie_catalog AS SELECT
  t.id,l.added_date,t.age_rating,t.backdrop_url,t.compact_poster_url,t.countries_json,
  t.description,t.director_json,t.en_name,t.genres_json,
  COALESCE(v.is_series,CASE WHEN v.title_id IS NULL THEN 0 END) AS is_series,
  CAST(t.kp_id AS INTEGER) AS kp_id,t.poster_url,t.name,t.movie_length,t.actors_json,
  t.rating,t.year_json,t.sequels_and_prequels_json,t.similar_movies_json,
  t.name_search,t.actors_search_json,t.director_search_json,
  (SELECT q.value FROM title_formats f JOIN qualities q ON q.id=f.quality_id
    WHERE f.title_id=t.id ORDER BY f.quality_id,f.extension_id LIMIT 1) AS quality,
  (SELECT e.value FROM title_formats f JOIN extensions e ON e.id=f.extension_id
    WHERE f.title_id=t.id ORDER BY f.quality_id,f.extension_id LIMIT 1) AS extension
FROM titles t JOIN library_entries l ON l.title_id=t.id
LEFT JOIN legacy_movie_values v ON v.title_id=t.id WHERE t.kind='movie';
`;
