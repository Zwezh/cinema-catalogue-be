const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createClient } = require('@libsql/client');
const { initializeDatabase } = require('../src/database/schema');
const {
  TitlesRepository,
} = require('../src/database/titles/titles.repository');
const { TitlesService } = require('../src/shared/titles/titles.service');
const { WishlistService } = require('../src/modules/wishlist/wishlist.service');
const {
  providerWishlist,
} = require('../src/modules/wishlist/provider-wishlist');
const { MoviesRepository } = require('../src/modules/movies/movies.repository');
const { MoviesService } = require('../src/modules/movies/movies.service');
const {
  SettingsRepository,
} = require('../src/modules/settings/settings.repository');
const { SettingsService } = require('../src/modules/settings/settings.service');
const metadata = (kind = 'series') => ({
  kpId: '6058297',
  kind,
  name: 'Provider title',
  enName: 'Original',
  description: 'Text',
  actors: [],
  directors: [],
  countries: [],
  genres: [],
  similarMovies: [],
  sequelsAndPrequels: [],
  ageRating: null,
  rating: 8,
  year: 2025,
  movieLength: 50,
  posterUrl: '',
  compactPosterUrl: '',
  backdropUrl: '',
  releaseDate: '2025-01-01',
  series:
    kind === 'series'
      ? {
          startYear: 2025,
          endYear: null,
          productionStatus: 'in_production',
          announcedSeasonCount: null,
          seasons: [{ seasonNumber: 1, releaseYear: 2025 }],
        }
      : null,
});
async function fixture(t, kind = 'series') {
  const dir = mkdtempSync(join(tmpdir(), 'wishlist-provider-'));
  const client = createClient({ url: `file:${join(dir, 'test.db')}` });
  t.after(() => {
    client.close();
    rmSync(dir, { recursive: true, force: true });
  });
  await initializeDatabase(client);
  const titles = new TitlesService(new TitlesRepository({ client }));
  const provider = { getTitleAutofill: async () => metadata(kind) };
  const wishlist = new WishlistService(titles, provider);
  return {
    client,
    titles,
    provider,
    wishlist,
    movies: new MoviesService(new MoviesRepository({ client })),
    settings: new SettingsService(new SettingsRepository({ client })),
  };
}
const bad = (status) => (e) => e.getStatus() === status;
const input = (title) => {
  const { id, availableSeasonCount, ...draft } = title;
  return draft;
};
test('provider creates a series Wishlist ID with unavailable seasons and primary details', async (t) => {
  const { wishlist } = await fixture(t);
  const created = await wishlist.createFromKinopoisk({ kpId: '06058297' });
  assert.deepEqual(Object.keys(created), ['id']);
  const title = await wishlist.findOne(created.id);
  assert.equal(title.kpId, '6058297');
  assert.equal(title.series.productionStatus, 'in_production');
  assert.deepEqual(title.series.seasons, [
    { seasonNumber: 1, releaseYear: 2025, isAvailable: false, formats: [] },
  ]);
  await assert.rejects(
    wishlist.createFromKinopoisk({ kpId: '6058297' }),
    bad(409),
  );
  for (const kpId of [null, '0', 'abc', 5])
    await assert.rejects(wishlist.createFromKinopoisk({ kpId }), bad(400));
});
test('refresh replaces provider metadata, preserves identity, added date, local seasons and formats', async (t) => {
  const { wishlist, provider, titles, settings } = await fixture(t);
  const { id } = await wishlist.createFromKinopoisk({ kpId: '6058297' });
  const before = await wishlist.findOne(id);
  const options = await settings.getSettings();
  const format = {
    qualityId: options.quality[0].id,
    extensionId: options.extension[0].id,
  };
  await titles.update(
    id,
    {
      ...input(before),
      series: {
        ...before.series,
        seasons: [
          { ...before.series.seasons[0], isAvailable: true, formats: [format] },
          {
            seasonNumber: 2,
            releaseYear: 2026,
            isAvailable: false,
            formats: [],
          },
        ],
      },
    },
    'wishlist',
  );
  provider.getTitleAutofill = async () => ({
    ...metadata(),
    name: 'Fresh title',
    rating: null,
    description: '',
    series: {
      ...metadata().series,
      seasons: [
        { seasonNumber: 1, releaseYear: 2025 },
        { seasonNumber: 3, releaseYear: null },
      ],
    },
  });
  const refreshed = await wishlist.refresh(id, { kpId: '6058297' });
  assert.equal(refreshed.name, 'Fresh title');
  assert.equal(refreshed.rating, null);
  assert.equal(refreshed.description, '');
  assert.equal(refreshed.addedDate, before.addedDate);
  assert.equal(refreshed.id, id);
  assert.deepEqual(
    refreshed.series.seasons.map((s) => s.seasonNumber),
    [1, 2, 3],
  );
  assert.deepEqual(refreshed.series.seasons[0].formats, [format]);
  assert.equal(refreshed.series.seasons[0].isAvailable, true);
  await assert.rejects(wishlist.refresh(id, { kpId: '123' }), bad(409));
});
test('provider failures and changed kind preserve all existing Wishlist data', async (t) => {
  const { wishlist, provider } = await fixture(t);
  const { id } = await wishlist.createFromKinopoisk({ kpId: '6058297' });
  const before = await wishlist.findOne(id);
  provider.getTitleAutofill = async () => {
    throw new Error('offline');
  };
  await assert.rejects(wishlist.refresh(id, { kpId: '6058297' }));
  assert.deepEqual(await wishlist.findOne(id), before);
  provider.getTitleAutofill = async () => metadata('movie');
  await assert.rejects(wishlist.refresh(id, { kpId: '6058297' }), bad(409));
  assert.deepEqual(await wishlist.findOne(id), before);
  provider.getTitleAutofill = async () => ({ ...metadata(), kind: null });
  await assert.rejects(wishlist.createFromKinopoisk({ kpId: '123' }), bad(502));
});
test('manual series create consumes a matching Wishlist in one atomic unit and keeps its ID', async (t) => {
  const { wishlist, titles, client } = await fixture(t);
  const { id } = await wishlist.createFromKinopoisk({ kpId: '6058297' });
  const before = await wishlist.findOne(id);
  const saved = await titles.create(
    { ...input(before), addedDate: '2026-10-09' },
    'library',
    true,
  );
  assert.equal(saved.id, id);
  await assert.rejects(wishlist.findOne(id), bad(404));
  assert.equal(
    (await client.execute('SELECT COUNT(*) AS n FROM titles')).rows[0].n,
    1,
  );
  await assert.rejects(titles.create(input(before), 'library', true), bad(409));
});
test('library validation failure and wrong source retain Wishlist; movie source moves with its ID', async (t) => {
  const { wishlist, movies, client } = await fixture(t, 'movie');
  const { id } = await wishlist.createFromKinopoisk({ kpId: '6058297' });
  const before = await wishlist.findOne(id);
  const { kind, series, formats, releaseDate, ...movie } = input(before);
  const draft = {
    ...movie,
    kpId: Number(movie.kpId),
    quality: '1080p',
    extension: 'MKV',
    isSeries: false,
    wishlistId: id,
  };
  await assert.rejects(
    movies.create({ ...draft, quality: 'not-a-format' }),
    bad(400),
  );
  assert.deepEqual(await wishlist.findOne(id), before);
  await assert.rejects(
    movies.create({ ...draft, wishlistId: 'wrong' }),
    bad(409),
  );
  const saved = await movies.create(draft);
  assert.equal(saved.id, id);
  await assert.rejects(wishlist.findOne(id), bad(404));
  assert.equal(
    (await client.execute('SELECT COUNT(*) AS n FROM titles')).rows[0].n,
    1,
  );
});
test('late refresh cannot overwrite a concurrent refresh or recreate a deleted title', async (t) => {
  const { wishlist, provider } = await fixture(t);
  const { id } = await wishlist.createFromKinopoisk({ kpId: '6058297' });
  let release, started;
  const gate = new Promise((resolve) => (started = resolve));
  provider.getTitleAutofill = () => {
    started();
    return new Promise((resolve) => (release = resolve));
  };
  const late = wishlist.refresh(id, { kpId: '6058297' });
  await gate;
  provider.getTitleAutofill = async () => ({ ...metadata(), name: 'Newer' });
  await wishlist.refresh(id, { kpId: '6058297' });
  release({ ...metadata(), name: 'Older' });
  await assert.rejects(late, bad(409));
  assert.equal((await wishlist.findOne(id)).name, 'Newer');
  let done;
  const ready = new Promise((resolve) => (done = resolve));
  provider.getTitleAutofill = () => {
    done();
    return new Promise((resolve) => (release = resolve));
  };
  const pending = wishlist.refresh(id, { kpId: '6058297' });
  await ready;
  await wishlist.delete(id);
  release(metadata());
  await assert.rejects(pending, bad(404));
  await assert.rejects(wishlist.findOne(id), bad(404));
});
test('late refresh cannot update a title moved into the library', async (t) => {
  const { wishlist, titles, provider } = await fixture(t);
  const { id } = await wishlist.createFromKinopoisk({ kpId: '6058297' });
  const before = await wishlist.findOne(id);
  let release, started;
  const gate = new Promise((resolve) => (started = resolve));
  provider.getTitleAutofill = () => {
    started();
    return new Promise((resolve) => (release = resolve));
  };
  const pending = wishlist.refresh(id, { kpId: '6058297' });
  await gate;
  await titles.create({ ...input(before), wishlistId: id }, 'library', true);
  release(metadata());
  await assert.rejects(pending, bad(404));
  assert.equal((await titles.findOne(id, 'library', true)).id, id);
});

test('HTTP Wishlist import, refresh, authenticated deletion and editor save use the provider-only contract', async (t) => {
  const { NestFactory } = require('@nestjs/core');
  const request = require('supertest');
  const bcrypt = require('bcrypt');
  const { DatabaseService } = require('../src/database/database.service');
  const {
    KinopoiskService,
  } = require('../src/modules/kinopoisk/kinopoisk.service');
  const dir = mkdtempSync(join(tmpdir(), 'wishlist-http-'));
  const saved = { ...process.env };
  let app;
  t.after(async () => {
    if (app) await app.close();
    process.env = saved;
    rmSync(dir, { recursive: true, force: true });
  });
  Object.assign(process.env, {
    NODE_ENV: 'test',
    JWT_KEY: 'a'.repeat(32),
    TURSO_DATABASE_URL: `file:${join(dir, 'test.db')}`,
    TURSO_REPLICA_PATH: '',
    DATABASE_AUTO_MIGRATE: 'true',
    REFRESH_COOKIE_SAMESITE: 'lax',
    CORS_ORIGINS: 'http://localhost:4200',
  });
  const { AppModule } = require('../src/app.module');
  app = await NestFactory.create(AppModule, {
    logger: false,
    abortOnError: false,
  });
  app.setGlobalPrefix('api');
  await app.init();
  const client = app.get(DatabaseService).client;
  await client.execute({
    sql: 'INSERT INTO auth_credentials VALUES(?,?)',
    args: ['admin', await bcrypt.hash('test-secret', 4)],
  });
  const provider = app.get(KinopoiskService);
  let calls = 0;
  provider.getTitleAutofill = async () => {
    calls++;
    return metadata();
  };
  const http = request(app.getHttpServer());
  await http
    .post('/api/wishlist/from-kinopoisk')
    .send({ kpId: '6058297' })
    .expect(401);
  assert.equal(calls, 0);
  const login = await http
    .post('/api/auth')
    .set('Origin', 'http://localhost:4200')
    .set('X-MediaShelf-Request', '1')
    .send({ secretKey: 'test-secret' })
    .expect(201);
  const auth = (path) =>
    http.post(path).auth(login.body.access_token, { type: 'bearer' });
  const created = await auth('/api/wishlist/from-kinopoisk')
    .send({ kpId: '6058297' })
    .expect(201);
  assert.deepEqual(Object.keys(created.body), ['id']);
  const id = created.body.id;
  const detail = await http.get(`/api/wishlist/${id}`).expect(200);
  assert.equal(detail.body.series.seasons[0].isAvailable, false);
  provider.getTitleAutofill = async () => ({
    ...metadata(),
    name: 'Fresh from HTTP',
  });
  const refreshed = await auth(`/api/wishlist/${id}/refresh`)
    .send({ kpId: '6058297' })
    .expect(200);
  assert.equal(refreshed.body.name, 'Fresh from HTTP');
  await auth(`/api/wishlist/${id}/refresh`).send({ kpId: '123' }).expect(409);
  await auth('/api/wishlist').send({}).expect(404);
  await auth(`/api/wishlist/${id}/promote`)
    .send({ addedDate: '2026-10-09' })
    .expect(404);
  const library = await auth('/api/series')
    .send({ ...input(refreshed.body), wishlistId: id, addedDate: '2026-10-09' })
    .expect(201);
  assert.equal(library.body.id, id);
  await http.get(`/api/wishlist/${id}`).expect(404);
  await http.get(`/api/series/${id}`).expect(200);
  await http.delete(`/api/wishlist/${id}`).expect(401);
  provider.getTitleAutofill = async () => ({ ...metadata(), kpId: '123' });
  const another = await auth('/api/wishlist/from-kinopoisk')
    .send({ kpId: '123' })
    .expect(201);
  await http
    .delete(`/api/wishlist/${another.body.id}`)
    .auth(login.body.access_token, { type: 'bearer' })
    .expect(200);
  await http.get(`/api/wishlist/${another.body.id}`).expect(404);
});
