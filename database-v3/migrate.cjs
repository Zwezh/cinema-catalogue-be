// Explicit opt-in migration. Default mode validates everything, then rolls back.
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { createClient } = require('@libsql/client');

async function migrate() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--apply')) throw new Error('Usage: node migrate.cjs [--apply]');
  const apply = args.includes('--apply');
  if (!process.env.TURSO_DATABASE_URL) throw new Error('TURSO_DATABASE_URL is required');
  const client = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  let tx;
  try {
    await client.execute('PRAGMA foreign_keys = ON');
    tx = await client.transaction('write');
    const existing = await tx.execute("SELECT name FROM sqlite_master WHERE type = 'table'");
    const tables = new Set(existing.rows.map((row) => String(row.name)));
    if (tables.has('catalog_migrations')) {
      const applied = await tx.execute("SELECT id FROM catalog_migrations WHERE id = 'catalog-v3'");
      if (!applied.rows.length) throw new Error('Incomplete or unrelated target schema; refusing migration');
      await tx.rollback();
      console.log('catalog-v3 already applied; no changes');
      return;
    }
    for (const table of ['movies', 'settings', 'quality_options', 'extension_options', 'auth']) {
      if (!tables.has(table)) throw new Error(`Missing source table: ${table}`);
    }
    if (tables.has('schema_migrations')) {
      const version = await tx.execute('SELECT MAX(version) AS version FROM schema_migrations');
      if (Number(version.rows[0].version) > 2) throw new Error('Unexpected newer source schema');
    }
    const settings = await tx.execute('SELECT id FROM settings');
    if (settings.rows.length !== 1 || Number(settings.rows[0].id) !== 1) {
      throw new Error('Expected exactly one legacy settings row with id=1');
    }
    const booleans = await tx.execute('SELECT id FROM movies WHERE is_series IS NOT NULL AND is_series NOT IN (0, 1) LIMIT 1');
    if (booleans.rows.length) throw new Error('Invalid legacy is_series; source left unchanged');
    await tx.executeMultiple(readFileSync(join(__dirname, 'schema.sql'), 'utf8'));
    await tx.executeMultiple(readFileSync(join(__dirname, 'migrate.sql'), 'utf8'));
    const sourceColumns = await tx.execute('PRAGMA table_info(movies)');
    for (const column of ['name_search', 'actors_search_json', 'director_search_json']) {
      if (sourceColumns.rows.some((row) => row.name === column)) {
        await tx.execute(`UPDATE titles SET ${column} = (SELECT ${column} FROM movies WHERE movies.id = titles.id)`);
      }
    }
    const fk = await tx.execute('PRAGMA foreign_key_check');
    if (fk.rows.length) throw new Error('Foreign key validation failed');

    // Exact field comparison, not just row counts. JSON text is not reserialized.
    const differences = await tx.execute(`SELECT m.id FROM movies m LEFT JOIN titles t ON t.id = m.id
      LEFT JOIN library_entries l ON l.title_id = m.id
      LEFT JOIN legacy_movie_values v ON v.title_id = m.id
      WHERE t.id IS NULL OR l.added_date IS NOT m.added_date OR v.is_series IS NOT m.is_series
      OR v.kp_id IS NOT m.kp_id OR t.kp_id IS NOT CAST(m.kp_id AS TEXT)
      OR t.name IS NOT m.name OR t.en_name IS NOT m.en_name OR t.description IS NOT m.description
      OR t.age_rating IS NOT m.age_rating OR t.rating IS NOT m.rating OR t.movie_length IS NOT m.movie_length
      OR t.poster_url IS NOT m.poster_url OR t.compact_poster_url IS NOT m.compact_poster_url
      OR t.backdrop_url IS NOT m.backdrop_url OR t.countries_json IS NOT m.countries_json
      OR t.genres_json IS NOT m.genres_json OR t.director_json IS NOT m.director_json
      OR t.actors_json IS NOT m.actors_json OR t.year_json IS NOT m.year_json
      OR t.sequels_and_prequels_json IS NOT m.sequels_and_prequels_json
      OR t.similar_movies_json IS NOT m.similar_movies_json
      OR NOT EXISTS (SELECT 1 FROM title_formats f JOIN qualities q ON q.id=f.quality_id
        JOIN extensions e ON e.id=f.extension_id
        WHERE f.title_id=m.id AND q.value=m.quality AND e.value=m.extension)`);
    if (differences.rows.length) throw new Error('Movie preservation verification failed');
    const counts = await tx.execute('SELECT (SELECT COUNT(*) FROM movies) AS source, (SELECT COUNT(*) FROM titles) AS target');
    if (Number(counts.rows[0].source) !== Number(counts.rows[0].target)) throw new Error('Row count mismatch');
    for (const sql of [
      'SELECT id, secret_key FROM auth EXCEPT SELECT id, secret_key FROM auth_credentials',
      "SELECT 'settings:default', genres_for_filters_json FROM settings EXCEPT SELECT id, genres_for_filters_json FROM app_settings",
      'SELECT o.value, o.title, o.is_default, o.sort_order FROM quality_options o EXCEPT SELECT q.value, q.title, s.is_default, s.sort_order FROM settings_qualities s JOIN qualities q ON q.id=s.quality_id',
      'SELECT o.value, o.is_default, o.sort_order FROM extension_options o EXCEPT SELECT e.value, s.is_default, s.sort_order FROM settings_extensions s JOIN extensions e ON e.id=s.extension_id',
    ]) {
      if ((await tx.execute(sql)).rows.length) throw new Error('Settings/auth preservation verification failed');
    }
    // Make the existing v2 application refuse startup instead of writing stale tables.
    await tx.execute(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`);
    await tx.execute("INSERT INTO schema_migrations(version, applied_at) VALUES (3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))");
    if (apply) await tx.commit();
    else await tx.rollback();
    console.log(`${apply ? 'Applied' : 'Validated and rolled back'} catalog-v3; ${counts.rows[0].source} titles preserved`);
  } finally {
    tx?.close();
    client.close();
  }
}
migrate().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Migration failed');
  process.exitCode = 1;
});
