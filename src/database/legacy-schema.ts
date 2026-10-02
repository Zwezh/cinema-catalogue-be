import { loginAttemptsSchema } from './login-attempts.schema';
import { normalizeSearch } from './search';
import { storedStringArray } from './json';
import type { Client, InStatement } from '@libsql/client';

export type ExtensionOptionRecord = {
  readonly default?: boolean;
  readonly value: string;
};

export type QualityOptionRecord = ExtensionOptionRecord & {
  readonly title: string;
};

export const defaultQuality: readonly QualityOptionRecord[] = [
  { title: '2160p 4K', value: '2160p' },
  { title: '1080p FHD', value: '1080p', default: true },
  { title: '1080i FHD', value: '1080i' },
  { title: '720p HD', value: '720p' },
  { title: 'SD HDTV', value: 'HDTV' },
  { title: 'SD LOW', value: 'LOW' },
];

export const defaultExtensions: readonly ExtensionOptionRecord[] = [
  { value: 'MKV', default: true },
  { value: 'M4V' },
  { value: 'TS' },
  { value: 'AVI' },
  { value: 'MP4' },
];

const coreSchemaStatements = [
  ...loginAttemptsSchema,

  `CREATE TABLE IF NOT EXISTS auth (
    id TEXT PRIMARY KEY,
    secret_key TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS movies (
    id TEXT PRIMARY KEY,
    added_date TEXT NOT NULL,
    age_rating INTEGER,
    backdrop_url TEXT NOT NULL,
    compact_poster_url TEXT NOT NULL,
    countries_json TEXT NOT NULL,
    description TEXT NOT NULL,
    director_json TEXT NOT NULL,
    en_name TEXT NOT NULL,
    extension TEXT NOT NULL,
    genres_json TEXT NOT NULL,
    is_series INTEGER,
    kp_id INTEGER NOT NULL,
    poster_url TEXT NOT NULL,
    name TEXT NOT NULL,
    movie_length INTEGER NOT NULL,
    actors_json TEXT NOT NULL,
    quality TEXT NOT NULL,
    rating REAL NOT NULL,
    year_json TEXT NOT NULL,
    sequels_and_prequels_json TEXT NOT NULL,
    similar_movies_json TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_movies_name ON movies(name)',
  'CREATE INDEX IF NOT EXISTS idx_movies_rating ON movies(rating)',
  'CREATE INDEX IF NOT EXISTS idx_movies_added_date ON movies(added_date)',
];

const settingsCatalogStatements = [
  `CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    genres_for_filters_json TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS quality_options (
    settings_id INTEGER NOT NULL DEFAULT 1 REFERENCES settings(id) ON DELETE CASCADE,
    value TEXT NOT NULL,
    title TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
    PRIMARY KEY (settings_id, value),
    UNIQUE (settings_id, sort_order)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_quality_options_one_default
    ON quality_options(settings_id) WHERE is_default = 1`,
  `CREATE TABLE IF NOT EXISTS extension_options (
    settings_id INTEGER NOT NULL DEFAULT 1 REFERENCES settings(id) ON DELETE CASCADE,
    value TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
    PRIMARY KEY (settings_id, value),
    UNIQUE (settings_id, sort_order)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_extension_options_one_default
    ON extension_options(settings_id) WHERE is_default = 1`,
];

export async function initializeDatabase(client: Client): Promise<void> {
  const ledger = await client.execute(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
  );
  if (ledger.rows.length) {
    const current = await client.execute(
      'SELECT MAX(version) AS version FROM schema_migrations',
    );
    if (Number(current.rows[0].version) > databaseSchemaVersion) {
      throw new Error(
        'Database schema is newer than this application; downgrade migration refused',
      );
    }
  }
  await client.batch(coreSchemaStatements, 'write');
  await migrateLegacySettings(client);
  await client.batch(settingsCatalogStatements, 'write');
  await client.execute(
    `INSERT OR IGNORE INTO settings (id, genres_for_filters_json)
     VALUES (1, '[]')`,
  );

  const transaction = await client.transaction('write');
  try {
    const quality = await transaction.execute(
      'SELECT COUNT(*) AS count FROM quality_options WHERE settings_id = 1',
    );
    const extensions = await transaction.execute(
      'SELECT COUNT(*) AS count FROM extension_options WHERE settings_id = 1',
    );
    if (Number(quality.rows[0].count) === 0) {
      await transaction.batch(qualityStatements(defaultQuality));
    }
    if (Number(extensions.rows[0].count) === 0) {
      await transaction.batch(extensionStatements(defaultExtensions));
    }
    await transaction.commit();
  } finally {
    transaction.close();
  }
  await migrateSearchColumns(client);
}

export function replaceCatalogStatements(
  quality: readonly QualityOptionRecord[],
  extensions: readonly ExtensionOptionRecord[],
): InStatement[] {
  return [
    'DELETE FROM quality_options WHERE settings_id = 1',
    'DELETE FROM extension_options WHERE settings_id = 1',
    ...qualityStatements(quality),
    ...extensionStatements(extensions),
  ];
}

function qualityStatements(
  quality: readonly QualityOptionRecord[],
): InStatement[] {
  return quality.map((option, index) => ({
    sql: `INSERT INTO quality_options
      (settings_id, value, title, is_default, sort_order) VALUES (1, ?, ?, ?, ?)`,
    args: [option.value, option.title, Number(option.default === true), index],
  }));
}

function extensionStatements(
  extensions: readonly ExtensionOptionRecord[],
): InStatement[] {
  return extensions.map((option, index) => ({
    sql: `INSERT INTO extension_options
      (settings_id, value, is_default, sort_order) VALUES (1, ?, ?, ?)`,
    args: [option.value, Number(option.default === true), index],
  }));
}

async function migrateLegacySettings(client: Client): Promise<void> {
  const columns = await client.execute('PRAGMA table_info(settings)');
  if (!columns.rows.some((column) => column.name === 'quality_json')) return;

  const transaction = await client.transaction('write');
  try {
    // Recheck under the write lock: another instance may already have migrated.
    const lockedColumns = await transaction.execute(
      'PRAGMA table_info(settings)',
    );
    if (!lockedColumns.rows.some((column) => column.name === 'quality_json')) {
      await transaction.commit();
      return;
    }
    const legacy = await transaction.execute(
      'SELECT quality_json, extension_json FROM settings WHERE id = 1',
    );
    const row = legacy.rows[0];
    const quality = row
      ? parseLegacyCatalog(row.quality_json, true)
      : defaultQuality;
    const extensions = row
      ? parseLegacyCatalog(row.extension_json, false)
      : defaultExtensions;
    await transaction.batch([
      'DROP TABLE IF EXISTS quality_options',
      'DROP TABLE IF EXISTS extension_options',
      `CREATE TABLE settings_normalized (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        genres_for_filters_json TEXT NOT NULL
      )`,
      `INSERT INTO settings_normalized (id, genres_for_filters_json)
       SELECT id, genres_for_filters_json FROM settings`,
      'DROP TABLE settings',
      'ALTER TABLE settings_normalized RENAME TO settings',
      ...settingsCatalogStatements,
      ...qualityStatements(quality as readonly QualityOptionRecord[]),
      ...extensionStatements(extensions),
    ]);
    await transaction.commit();
  } finally {
    transaction.close();
  }
}

function parseLegacyCatalog(
  value: unknown,
  requiresTitle: boolean,
): ExtensionOptionRecord[] {
  const parsed: unknown = JSON.parse(String(value));
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(
      'Legacy catalog must be a non-empty array; migration aborted',
    );
  }
  const values = new Set<string>();
  let defaults = 0;
  for (const entry of parsed as unknown[]) {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      !('value' in entry) ||
      typeof entry.value !== 'string' ||
      !entry.value.trim() ||
      values.has(entry.value.trim().toLowerCase()) ||
      ('default' in entry && typeof entry.default !== 'boolean') ||
      (requiresTitle &&
        (!('title' in entry) ||
          typeof entry.title !== 'string' ||
          !entry.title.trim()))
    ) {
      throw new Error('Invalid legacy catalog; migration aborted');
    }
    values.add(entry.value.trim().toLowerCase());
    if ('default' in entry && entry.default === true) defaults++;
  }
  if (defaults !== 1)
    throw new Error('Legacy catalog must have one default; migration aborted');
  return parsed as ExtensionOptionRecord[];
}

export const databaseSchemaVersion = 2;

async function migrateSearchColumns(client: Client): Promise<void> {
  const transaction = await client.transaction('write');
  try {
    await transaction.execute(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL
    )`);
    const columns = await transaction.execute('PRAGMA table_info(movies)');
    const additions = [
      ['name_search', "TEXT NOT NULL DEFAULT ''"],
      ['actors_search_json', "TEXT NOT NULL DEFAULT '[]'"],
      ['director_search_json', "TEXT NOT NULL DEFAULT '[]'"],
    ] as const;
    const missing = additions.filter(
      ([name]) => !columns.rows.some((column) => column.name === name),
    );
    for (const [name, definition] of missing)
      await transaction.execute(
        `ALTER TABLE movies ADD COLUMN ${name} ${definition}`,
      );
    if (missing.length > 0) {
      const movies = await transaction.execute(
        'SELECT id, name, actors_json, director_json FROM movies',
      );
      for (const movie of movies.rows) {
        await transaction.execute({
          sql: 'UPDATE movies SET name_search = ?, actors_search_json = ?, director_search_json = ? WHERE id = ?',
          args: [
            normalizeSearch(String(movie.name)),
            JSON.stringify(
              storedStringArray(movie.actors_json, 'actors_json').map(
                normalizeSearch,
              ),
            ),
            JSON.stringify(
              storedStringArray(movie.director_json, 'director_json').map(
                normalizeSearch,
              ),
            ),
            String(movie.id),
          ],
        });
      }
    }
    await transaction.batch(
      [1, databaseSchemaVersion].map((version) => ({
        sql: 'INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)',
        args: [version, new Date().toISOString()],
      })),
    );
    await transaction.commit();
  } finally {
    transaction.close();
  }
}

export async function assertDatabaseVersion(client: Client): Promise<void> {
  const exists = await client.execute(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
  );
  if (!exists.rows.length)
    throw new Error('Database migrations are required; run npm run migrate');
  const result = await client.execute(
    'SELECT version FROM schema_migrations ORDER BY version',
  );
  if (
    result.rows.length !== databaseSchemaVersion ||
    result.rows.some((row, index) => Number(row.version) !== index + 1)
  ) {
    throw new Error(
      'Database schema version does not match this application; run the matching migrations',
    );
  }
}
