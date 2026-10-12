const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createClient } = require('@libsql/client');
const {
  initializeDatabase,
  assertDatabaseVersion,
} = require('../src/database/schema');
const {
  StatisticsRepository,
} = require('../src/database/statistics/statistics.repository');
const {
  TitlesRepository,
} = require('../src/database/titles/titles.repository');
const { TitlesService } = require('../src/shared/titles/titles.service');
const {
  parseStatisticsSnapshot,
} = require('../src/modules/statistics/statistics-validation');
async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'statistics-'));
  const client = createClient({ url: `file:${join(dir, 'db')}` });
  t.after(() => {
    client.close();
    rmSync(dir, { recursive: true, force: true });
  });
  await initializeDatabase(client);
  const statistics = new StatisticsRepository({ client });
  const titles = new TitlesService(new TitlesRepository({ client }));
  const qualities = await client.execute('SELECT id,value FROM qualities');
  const extensions = await client.execute('SELECT id FROM extensions');
  const format = (quality, i = 0) => ({
    qualityId: qualities.rows.find((q) => q.value === quality).id,
    extensionId: extensions.rows[i].id,
  });
  const create = (value, membership = 'library') =>
    titles.create(
      { name: 'Title', addedDate: '2026-10-10', kind: 'movie', ...value },
      membership,
      value.kind === 'series',
    );
  return { client, statistics, create, format };
}
test('statistics starts unscanned and persists a scanned empty library through restart', async (t) => {
  const { client, statistics } = await fixture(t);
  assert.equal(await statistics.getSnapshot(), null);
  const snapshot = await statistics.scan();
  assert.equal(snapshot.totals.titles, 0);
  assert.equal(snapshot.ratings.mean, null);
  assert.equal(snapshot.ratings.bins.length, 10);
  await initializeDatabase(client);
  await assertDatabaseVersion(client);
  assert.deepEqual(
    await new StatisticsRepository({ client }).getSnapshot(),
    snapshot,
  );
});
test('statistics excludes Wishlist, deduplicates formats and genres, preserves zero and unknown and computes exact distributions', async (t) => {
  const { client, statistics, create, format } = await fixture(t);
  const a = await create({
    year: [2000, 2002],
    rating: 6,
    movieLength: 120,
    genres: ['Drama', 'Sci-Fi'],
    formats: [format('1080p'), format('1080p', 1)],
  });
  await client.execute({
    sql: 'INSERT INTO wishlist_entries VALUES(?,?)',
    args: [a.id, '2026-10-10'],
  });
  await create({});
  await create({
    year: 2020,
    rating: 0,
    movieLength: 0,
    formats: [format('1080p'), format('720p')],
  });
  await create({
    kind: 'series',
    rating: 10,
    genres: ['Drama'],
    series: {
      startYear: 2010,
      productionStatus: 'in_production',
      seasons: [
        { seasonNumber: 0, isAvailable: true, formats: [format('1080p')] },
        { seasonNumber: 1, isAvailable: true, formats: [format('720p')] },
        { seasonNumber: 2, isAvailable: false, formats: [format('2160p')] },
      ],
    },
  });
  await create(
    { year: 2090, rating: 9, movieLength: 500, genres: ['Wishlist only'] },
    'wishlist',
  );
  const snapshot = await statistics.scan();
  assert.deepEqual(snapshot.totals, {
    titles: 4,
    movies: 3,
    series: 1,
    movieRuntimeMinutes: 120,
    knownMovieRuntimes: 2,
    recordedSeasons: 3,
    availableSeasons: 1,
    titlesWithoutGenres: 2,
  });
  assert.deepEqual(snapshot.genres, [
    { label: 'Drama', count: 2 },
    { label: 'Sci-Fi', count: 1 },
  ]);
  assert.deepEqual(snapshot.qualities, [
    { kind: 'multiple', value: null, count: 2 },
    { kind: 'none', value: null, count: 1 },
    { kind: 'quality', value: '1080p', count: 1 },
  ]);
  assert.deepEqual(snapshot.decades, [
    { start: 2000, count: 1 },
    { start: 2010, count: 1 },
    { start: 2020, count: 1 },
  ]);
  assert.equal(snapshot.unknownYears, 1);
  assert.equal(snapshot.ratings.knownCount, 3);
  assert.equal(snapshot.ratings.mean, 16 / 3);
  assert.equal(snapshot.ratings.median, 6);
  assert.equal(snapshot.ratings.highRatedCount, 1);
  assert.equal(snapshot.ratings.bins[0].count, 1);
  assert.equal(snapshot.ratings.bins[9].count, 1);
  await create({ rating: 8 });
  assert.deepEqual(await statistics.getSnapshot(), snapshot);
  const rescan = await statistics.scan();
  assert.equal(rescan.totals.titles, 5);
  assert.equal(rescan.ratings.median, 7);
});
test('scan failure rolls back snapshot replacement and snapshot reads use one primary read without catalog aggregation', async (t) => {
  const { client, statistics, create } = await fixture(t);
  const saved = await statistics.scan();
  await create({ rating: 5 });
  await client.execute(
    "CREATE TRIGGER fail_statistics BEFORE UPDATE ON library_statistics_snapshot BEGIN SELECT RAISE(ABORT,'fixture'); END",
  );
  await assert.rejects(statistics.scan());
  assert.deepEqual(await statistics.getSnapshot(), saved);
  let calls = 0;
  const reader = new StatisticsRepository({
    client: {
      execute: async (sql) => {
        calls++;
        assert.match(sql, /SELECT payload_json/);
        return client.execute(sql);
      },
    },
    readClient: {
      execute: () => {
        throw Error('must use primary');
      },
    },
  });
  assert.deepEqual(await reader.getSnapshot(), saved);
  assert.equal(calls, 1);
  await client.execute('DROP TRIGGER fail_statistics');
  await Promise.all([statistics.scan(), statistics.scan()]);
  assert.equal((await statistics.getSnapshot()).totals.titles, 1);
});
test('statistics migration upgrades version eight without calculating or changing library rows', async (t) => {
  const { client, create } = await fixture(t);
  const title = await create({ rating: 9 });
  await client.executeMultiple(
    "DELETE FROM catalog_migrations WHERE id='catalog-v9-statistics'; DROP INDEX titles_statistics; DROP TABLE library_statistics_snapshot",
  );
  await assert.rejects(assertDatabaseVersion(client));
  await initializeDatabase(client);
  await initializeDatabase(client);
  assert.equal(
    (
      await client.execute(
        'SELECT COUNT(*) AS n FROM library_statistics_snapshot',
      )
    ).rows[0].n,
    0,
  );
  const plan = await client.execute(
    'EXPLAIN QUERY PLAN SELECT t.kind,t.movie_length,t.rating,t.year_json,t.id FROM titles t INDEXED BY titles_statistics JOIN library_entries l ON l.title_id=t.id',
  );
  assert.ok(
    plan.rows.some((row) =>
      String(row.detail).includes('COVERING INDEX titles_statistics'),
    ),
  );
  assert.equal(
    (await client.execute('SELECT id FROM titles')).rows[0].id,
    title.id,
  );
});
test('stored statistics validation rejects corrupt totals and bucket data', async (t) => {
  const { statistics } = await fixture(t);
  const value = await statistics.scan();
  for (const edit of [
    (s) => (s.version = 2),
    (s) => (s.totals.movies = 1),
    (s) => s.ratings.bins.pop(),
    (s) => (s.scannedAt = 'invalid'),
    (s) => s.qualities.push({ kind: 'none', value: null, count: 1 }),
  ]) {
    const data = structuredClone(value);
    edit(data);
    assert.throws(() => parseStatisticsSnapshot(data), /Invalid statistics/);
  }
});
test('HTTP statistics reads do not calculate, scan requires auth and rejects filters', async (t) => {
  const { NestFactory } = require('@nestjs/core');
  const { Module } = require('@nestjs/common');
  const request = require('supertest');
  const {
    StatisticsController,
  } = require('../src/modules/statistics/statistics.controller');
  const {
    StatisticsService,
  } = require('../src/modules/statistics/statistics.service');

  const { statistics } = await fixture(t);
  let authorized = false;
  class TestModule {}
  Module({
    controllers: [StatisticsController],
    providers: [
      {
        provide: StatisticsService,
        useValue: new StatisticsService(statistics),
      },
    ],
  })(TestModule);
  const passport = require('passport');
  passport.use('jwt', {
    authenticate() {
      if (authorized) this.success({ id: 'fixture' });
      else this.fail({}, 401);
    },
  });
  t.after(() => passport.unuse('jwt'));
  const app = await NestFactory.create(TestModule, { logger: false });
  await app.init();
  t.after(() => app.close());
  const http = request(app.getHttpServer());
  assert.deepEqual((await http.get('/statistics').expect(200)).body, {
    snapshot: null,
  });
  await http.post('/statistics/scan').send({}).expect(401);
  authorized = true;
  await http.post('/statistics/scan').send({ search: 'bad' }).expect(400);
  await http.get('/statistics?search=bad').expect(400);
  const result = (await http.post('/statistics/scan').send({}).expect(200))
    .body;
  assert.equal(result.snapshot.totals.titles, 0);
  assert.deepEqual((await http.get('/statistics').expect(200)).body, result);
});
