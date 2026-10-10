const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createClient } = require('@libsql/client');
const { initializeDatabase } = require('../src/database/schema');
const { TitlesService } = require('../src/shared/titles/titles.service');
const {
  TitlesRepository,
} = require('../src/database/titles/titles.repository');
const {
  GalleryRepository,
} = require('../src/database/gallery/gallery.repository');
const {
  validateGalleryQuery,
} = require('../src/modules/gallery/gallery-query-validation');
async function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'gallery-'));
  const client = createClient({ url: `file:${join(dir, 'db')}` });
  t.after(() => {
    client.close();
    rmSync(dir, { recursive: true, force: true });
  });
  await initializeDatabase(client);
  return {
    client,
    titles: new TitlesService(new TitlesRepository({ client })),
    gallery: new GalleryRepository({ client, readClient: client }),
  };
}
const query = (raw = {}) => validateGalleryQuery(raw);
test('Gallery scopes memberships once, preserves duplicate provider IDs, globally pages and stays compact', async (t) => {
  const { client, titles, gallery } = await setup(t);
  const movie = await titles.create(
    {
      kind: 'movie',
      name: 'Movie',
      addedDate: '2026-10-01',
      year: 2024,
      kpId: '11',
    },
    'library',
  );
  const series = await titles.create(
    {
      kind: 'series',
      name: 'Series',
      addedDate: '2026-10-02',
      kpId: '12',
      series: {
        startYear: 2020,
        endYear: null,
        productionStatus: 'in_production',
        seasons: [
          { seasonNumber: 0, isAvailable: true, formats: [] },
          { seasonNumber: 1, isAvailable: true, formats: [] },
          { seasonNumber: 2, isAvailable: false, formats: [] },
        ],
      },
    },
    'library',
    true,
  );
  const wish = await titles.create(
    { kind: 'movie', name: 'Wish', addedDate: '2026-10-03', kpId: '13' },
    'wishlist',
  );
  await client.execute({
    sql: 'INSERT INTO wishlist_entries VALUES(?,?)',
    args: [movie.id, '2026-10-04'],
  });
  const duplicate = await titles.create(
    { kind: 'movie', name: 'Historical copy', addedDate: '2026-10-05' },
    'wishlist',
  );
  await client.execute({
    sql: 'UPDATE titles SET kp_id=? WHERE id=?',
    args: ['11', duplicate.id],
  });
  const all = await gallery.findAll(query());
  assert.equal(all.totalCount, 4);
  assert.deepEqual(
    all.list.map((i) => i.id),
    [duplicate.id, wish.id, series.id, movie.id],
  );
  assert.equal(all.list.at(-1).collection, 'movies');
  const onlyWish = await gallery.findAll(query({ collections: 'wishlist' }));
  assert.equal(onlyWish.totalCount, 3);
  assert.equal(
    onlyWish.list.find((i) => i.id === movie.id).collection,
    'wishlist',
  );
  const onlySeries = await gallery.findAll(
    query({ collections: 'series', kinds: 'series' }),
  );
  assert.equal(onlySeries.totalCount, 1);
  assert.equal(onlySeries.list[0].series.availableSeasonCount, 1);
  assert.equal(onlySeries.list[0].series.recordedSeasonCount, 3);
  assert.equal('description' in all.list[0], false);
  assert.equal('seasons' in onlySeries.list[0].series, false);
  assert.equal('formats' in all.list[0], false);
  const page = await gallery.findAll(query({ pageSize: 2, currentPage: 1 }));
  assert.equal(page.totalCount, 4);
  assert.deepEqual(
    page.list.map((i) => i.id),
    [series.id, movie.id],
  );
  for (const direction of ['asc', 'desc']) {
    const sorted = await gallery.findAll(query({ key: 'rating', direction }));
    assert.deepEqual(
      sorted.list.map((i) => i.id),
      [...all.list.map((i) => i.id)].sort(),
    );
  }
});
test('Gallery keeps Unicode/literal search and every established filter with known zero values', async (t) => {
  const { client, titles, gallery } = await setup(t);
  const settings = await client.execute(
    "SELECT id FROM qualities WHERE value='1080p'",
  );
  const ext = await client.execute(
    "SELECT id FROM extensions WHERE value='MKV'",
  );
  const entry = await titles.create(
    {
      kind: 'series',
      name: 'Тест 100%_\\',
      addedDate: '2026-10-01',
      rating: 0,
      ageRating: 0,
      year: [2024],
      genres: ['Drama', 'Mystery'],
      actors: ['Actor One'],
      director: ['Director One'],
      series: {
        startYear: 2024,
        endYear: null,
        productionStatus: 'in_production',
        seasons: [
          {
            seasonNumber: 1,
            isAvailable: true,
            releaseYear: 2024,
            formats: [
              { qualityId: settings.rows[0].id, extensionId: ext.rows[0].id },
            ],
          },
        ],
      },
    },
    'wishlist',
  );
  const matched = await gallery.findAll(
    query({
      search: 'ТЕСТ 100%_\\',
      rating: 0,
      ageRating: '0',
      fromYear: 2024,
      toYear: 2024,
      genres: ['Drama', 'Mystery'],
      actors: 'actor',
      directors: 'DIRECTOR',
      quality: '1080p',
    }),
  );
  assert.equal(matched.list[0].id, entry.id);
  assert.deepEqual(matched.list[0].qualityValues, ['1080p']);
  assert.equal(matched.list[0].rating, 0);
  for (const filter of [
    { search: '100%wrong' },
    { rating: 1 },
    { ageRating: '18' },
    { fromYear: 2025 },
    { genres: 'Comedy' },
    { actors: 'missing' },
    { directors: 'missing' },
    { quality: '2160p' },
  ])
    assert.equal((await gallery.findAll(query(filter))).totalCount, 0);
});
test('Gallery query rejects invalid or unrelated parameters and canonicalizes scopes', () => {
  for (const raw of [
    { key: 'quality' },
    { collections: 'bad' },
    { kinds: 'bad' },
    { pageSize: 101 },
    { currentPage: -1 },
    { fromYear: 2025, toYear: 2024 },
    { unexpected: 'yes' },
    { collections: ['movies', 1] },
  ])
    assert.throws(() => query(raw));
  assert.deepEqual(
    query({ collections: ['wishlist,movies', 'movies'] }).collections,
    ['movies', 'wishlist'],
  );
  assert.deepEqual(query({ kinds: 'series,movie,series' }).kinds, [
    'movie',
    'series',
  ]);
});

test('Gallery uses one read snapshot and four bounded statements without hydrating seasons', async (t) => {
  const { client, titles } = await setup(t);
  const series = await titles.create(
    {
      kind: 'series',
      name: 'Many seasons',
      addedDate: '2026-10-01',
      description: 'Long description '.repeat(1000),
      actors: Array.from({ length: 100 }, (_, i) => `Actor ${i}`),
      series: {
        startYear: 2000,
        endYear: null,
        productionStatus: 'in_production',
        seasons: Array.from({ length: 100 }, (_, i) => ({
          seasonNumber: i + 1,
          releaseYear: 2000,
          isAvailable: true,
          formats: [],
        })),
      },
    },
    'library',
    true,
  );
  let transactions = 0;
  const statements = [];
  const readClient = {
    transaction: async (mode) => {
      transactions++;
      assert.equal(mode, 'read');
      const tx = await client.transaction(mode);
      return {
        execute: async (statement) => {
          statements.push(statement.sql);
          return tx.execute(statement);
        },
        batch: async (batch) => {
          statements.push(...batch.map((s) => s.sql));
          return tx.batch(batch);
        },
        close: () => tx.close(),
      };
    },
  };
  const gallery = new GalleryRepository({ client, readClient });
  const page = await gallery.findAll(query());
  assert.equal(transactions, 1);
  assert.equal(statements.length, 4);
  assert.equal(page.list[0].series.recordedSeasonCount, 100);
  const full = await titles.findOne(series.id, 'library', true);
  assert.ok(
    JSON.stringify(page.list[0]).length < JSON.stringify(full).length / 10,
  );
  const { id, availableSeasonCount, ...input } = full;
  void id;
  void availableSeasonCount;
  await titles.update(
    series.id,
    {
      ...input,
      series: { ...full.series, seasons: full.series.seasons.slice(0, 1) },
    },
    'library',
    true,
  );
  const short = await gallery.findAll(query());
  assert.ok(
    Math.abs(
      JSON.stringify(page.list[0]).length -
        JSON.stringify(short.list[0]).length,
    ) < 10,
  );
});
test('public Gallery HTTP endpoint returns summaries and rejects malformed scopes before SQL', async (t) => {
  const { NestFactory } = require('@nestjs/core');
  const { Module } = require('@nestjs/common');
  const request = require('supertest');
  const {
    GalleryController,
  } = require('../src/modules/gallery/gallery.controller');
  const { GalleryService } = require('../src/modules/gallery/gallery.service');
  const { gallery, titles } = await setup(t);
  await titles.create(
    { kind: 'movie', name: 'Public movie', addedDate: '2026-10-01' },
    'wishlist',
  );
  class TestGalleryModule {}
  Module({
    controllers: [GalleryController],
    providers: [
      { provide: GalleryService, useValue: new GalleryService(gallery) },
    ],
  })(TestGalleryModule);
  const app = await NestFactory.create(TestGalleryModule, { logger: false });
  await app.init();
  t.after(() => app.close());
  const response = await request(app.getHttpServer())
    .get('/gallery?collections=wishlist&kinds=movie')
    .expect(200);
  assert.equal(response.body.list[0].collection, 'wishlist');
  assert.equal(response.body.list[0].name, 'Public movie');
  assert.equal(response.body.list[0].description, undefined);
  await request(app.getHttpServer())
    .get('/gallery?collections=unknown')
    .expect(400);
  await request(app.getHttpServer()).get('/gallery?key=quality').expect(400);
});
test('Gallery scopes kinds independently and puts unknown sort values last in both directions', async (t) => {
  const { titles, gallery } = await setup(t);
  const movie = await titles.create(
    { kind: 'movie', name: 'Movie', addedDate: '2026-10-01', rating: 5 },
    'library',
  );
  const series = await titles.create(
    { kind: 'series', name: 'Series', addedDate: '2026-10-01', rating: 0 },
    'library',
    true,
  );
  const wish = await titles.create(
    { kind: 'series', name: 'Wish series', addedDate: '2026-10-01' },
    'wishlist',
  );
  assert.deepEqual(
    (
      await gallery.findAll(query({ key: 'rating', direction: 'asc' }))
    ).list.map((i) => i.id),
    [series.id, movie.id, wish.id],
  );
  assert.deepEqual(
    (
      await gallery.findAll(query({ key: 'rating', direction: 'desc' }))
    ).list.map((i) => i.id),
    [movie.id, series.id, wish.id],
  );
  assert.equal(
    (await gallery.findAll(query({ collections: 'movies', kinds: 'series' })))
      .totalCount,
    0,
  );
  assert.deepEqual(
    (
      await gallery.findAll(
        query({ collections: 'movies,wishlist', kinds: 'series' }),
      )
    ).list.map((i) => i.id),
    [wish.id],
  );
});
