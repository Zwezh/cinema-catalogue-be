const { test } = require('node:test');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const assert = require('node:assert/strict');
const { createClient } = require('@libsql/client');
const {
  initializeDatabase,
  replaceCatalogStatements,
} = require('../src/database/schema');
const { MoviesService } = require('../src/modules/movies/movies.service');
const { SettingsService } = require('../src/modules/settings/settings.service');
const {
  validateMovieQuery,
} = require('../src/modules/movies/query-validation');
const { JwtStrategy } = require('../src/modules/auth/jwt-strategy');

const movie = {
  addedDate: '2026-01-01',
  ageRating: null,
  backdropUrl: '',
  compactPosterUrl: '',
  countries: [],
  description: '',
  director: [],
  enName: '',
  extension: 'MKV',
  genres: ['Drama'],
  isSeries: null,
  kpId: 1,
  posterUrl: '',
  name: 'Example',
  movieLength: 100,
  actors: [],
  quality: '1080p',
  rating: 8,
  year: 2020,
  sequelsAndPrequels: [],
  similarMovies: [],
};
async function database(t, initialize = true) {
  // libSQL opens a separate connection for explicit transactions.
  const directory = mkdtempSync(join(tmpdir(), 'cinema-regression-'));
  const client = createClient({ url: `file:${join(directory, 'test.db')}` });
  t.after(() => {
    client.close();
    rmSync(directory, { recursive: true, force: true });
  });
  if (initialize) await initializeDatabase(client);
  return client;
}
async function legacy(client, quality) {
  await client.execute(
    'CREATE TABLE settings(id INTEGER PRIMARY KEY, genres_for_filters_json TEXT, quality_json TEXT, extension_json TEXT)',
  );
  await client.execute({
    sql: 'INSERT INTO settings VALUES(1, ?, ?, ?)',
    args: ['["Drama"]', quality, '[{"value":"CUSTOM","default":true}]'],
  });
}

test('legacy migration preserves catalogs, order and genres across restarts', async (t) => {
  const client = await database(t, false);
  await legacy(
    client,
    '[{"value":"CUSTOM","title":"Custom","default":true},{"value":"SECOND","title":"Second"}]',
  );
  await initializeDatabase(client);
  await initializeDatabase(client);
  const settings = await new SettingsService({ client }).getSettings();
  assert.deepEqual(
    settings.quality.map((x) => x.value),
    ['CUSTOM', 'SECOND'],
  );
  assert.deepEqual(settings.extension, [{ value: 'CUSTOM', default: true }]);
  assert.deepEqual(settings.genresForFilters, ['Drama']);
});

test('invalid legacy catalog aborts without dropping legacy data', async (t) => {
  const client = await database(t, false);
  await legacy(client, '[{"value":"CUSTOM","title":"Custom"}]');
  await assert.rejects(initializeDatabase(client), /one default/);
  assert.equal(
    (await client.execute('SELECT quality_json FROM settings')).rows.length,
    1,
  );
});

test('SQL migration failure rolls back table replacement', async (t) => {
  const client = await database(t, false);
  await legacy(client, '[{"value":"CUSTOM","title":"Custom","default":true}]');
  await client.execute("INSERT INTO settings VALUES(2, '[]', '[]', '[]')");
  await assert.rejects(initializeDatabase(client), /CHECK/);
  const rows = await client.execute(
    'SELECT quality_json FROM settings ORDER BY id',
  );
  assert.equal(rows.rows.length, 2);
  assert.match(rows.rows[0].quality_json, /CUSTOM/);
  assert.equal(
    (
      await client.execute(
        "SELECT name FROM sqlite_master WHERE name='settings_normalized'",
      )
    ).rows.length,
    0,
  );
});

test('initialization preserves a populated custom catalog when the other is empty', async (t) => {
  const client = await database(t);
  await client.batch(
    replaceCatalogStatements(
      [{ value: 'CUSTOM', title: 'Custom', default: true }],
      [{ value: 'CUSTOM', default: true }],
    ),
    'write',
  );
  await client.execute('DELETE FROM extension_options');
  await initializeDatabase(client);
  assert.deepEqual(
    (await new SettingsService({ client }).getSettings()).quality,
    [{ value: 'CUSTOM', title: 'Custom', default: true }],
  );
  await client.execute('DELETE FROM quality_options');
  await client.batch(
    replaceCatalogStatements(
      [{ value: 'CUSTOM', title: 'Custom', default: true }],
      [{ value: 'CUSTOM', default: true }],
    ),
    'write',
  );
  await client.execute('DELETE FROM quality_options');
  await initializeDatabase(client);
  assert.deepEqual(
    (await new SettingsService({ client }).getSettings()).extension,
    [{ value: 'CUSTOM', default: true }],
  );
});

test('concurrent creates and conflicting updates return 409 and preserve data', async (t) => {
  const client = await database(t);
  const service = new MoviesService({ client });
  const results = await Promise.allSettled([
    service.create(movie),
    service.create(movie),
  ]);
  assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal(
    results.find((x) => x.status === 'rejected').reason.getStatus(),
    409,
  );
  const other = await service.create({ ...movie, kpId: 2 });
  await assert.rejects(
    service.update({ ...other, kpId: 1 }),
    (e) => e.getStatus() === 409,
  );
  assert.equal((await service.findOne(other.id)).kpId, 2);
});

test('existing duplicates prevent unique-index migration without deleting movies', async (t) => {
  const client = await database(t);
  const service = new MoviesService({ client });
  await client.execute('DROP INDEX idx_movies_unique_kp_id');
  await service.create(movie);
  await service.create(movie);
  await assert.rejects(initializeDatabase(client), /UNIQUE/);
  assert.equal(
    (await client.execute('SELECT COUNT(*) AS n FROM movies')).rows[0].n,
    2,
  );
});

test('malformed public query values produce 400 before SQL', async () => {
  for (const query of [
    { pageSize: '1.5' },
    { pageSize: 'Infinity' },
    { pageSize: 101 },
    { rating: 'abc' },
    { actors: ['Alice', 'Bob'] },
    { key: '__proto__' },
    { genres: [{}] },
    { direction: 'DROP' },
    { currentPage: -1 },
    { fromYear: 2025, toYear: 2020 },
  ]) {
    assert.throws(
      () => validateMovieQuery(query),
      (e) => e.getStatus() === 400,
    );
  }
  const valid = validateMovieQuery({
    pageSize: '10',
    currentPage: '0',
    genres: 'Drama,Comedy',
    rating: '7.5',
  });
  assert.equal(valid.pageSize, 10);
  assert.equal(valid.rating, 7.5);
  assert.deepEqual(valid.genres, ['Drama', 'Comedy']);
});

test('pagination is stable and mutation responses reflect atomic operations', async (t) => {
  const client = await database(t);
  const service = new MoviesService({ client });
  const first = await service.create(movie);
  await service.create({ ...movie, kpId: 2 });
  const all = await service.findAll({});
  const a = await service.findAll({ pageSize: '1', currentPage: '0' });
  const b = await service.findAll({ pageSize: '1', currentPage: '1' });
  assert.deepEqual(
    [a.list[0].id, b.list[0].id],
    all.list.map((x) => x.id),
  );
  assert.equal(
    (await service.update({ ...first, name: 'Updated' })).name,
    'Updated',
  );
  assert.equal((await service.delete(first.id)).name, 'Updated');
  await assert.rejects(service.delete(first.id), (e) => e.getStatus() === 404);
});

test('JWT strategy returns an object principal and rejects malformed claims', () => {
  const strategy = new JwtStrategy({ get: () => 'test-only-secret' });
  assert.deepEqual(strategy.validate({ user: 'Administrator' }), {
    user: 'Administrator',
  });
  for (const payload of [null, {}, { user: 42 }, { user: '' }]) {
    assert.throws(
      () => strategy.validate(payload),
      (e) => e.getStatus() === 401,
    );
  }
});

test('settings rejects nonboolean defaults without changing existing data', async (t) => {
  const client = await database(t);
  const service = new SettingsService({ client });
  const before = await service.getSettings();
  await assert.rejects(
    service.update({
      ...before,
      quality: [
        ...before.quality,
        { value: 'BAD', title: 'Bad', default: 'yes' },
      ],
    }),
    (e) => e.getStatus() === 400,
  );
  assert.deepEqual(await service.getSettings(), before);
});
