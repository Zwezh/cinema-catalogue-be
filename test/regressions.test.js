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
const { MoviesRepository } = require('../src/modules/movies/movies.repository');
const { MoviesService } = require('../src/modules/movies/movies.service');
const {
  SettingsRepository,
} = require('../src/modules/settings/settings.repository');
const { SettingsService } = require('../src/modules/settings/settings.service');
const { validateTitleQuery } = require('../src/common/title-query-validation');
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
  const settings = await new SettingsService(
    new SettingsRepository({ client }),
  ).getSettings();
  assert.deepEqual(
    settings.quality.map((x) => x.value),
    ['CUSTOM', 'SECOND'],
  );
  assert.deepEqual(settings.extension, [
    { id: 'extension:435553544F4D', value: 'CUSTOM', default: true },
  ]);
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

test('initialization preserves customized catalogs without resetting retired options', async (t) => {
  const client = await database(t);
  await client.batch(
    replaceCatalogStatements(
      [{ value: 'CUSTOM', title: 'Custom', default: true }],
      [{ value: 'CUSTOM', default: true }],
    ),
    'write',
  );
  const before = await new SettingsRepository({ client }).getSettings();
  await initializeDatabase(client);
  const settings = await new SettingsRepository({ client }).getSettings();
  assert.deepEqual(settings.quality, [
    {
      id: before.quality[0].id,
      value: 'CUSTOM',
      title: 'Custom',
      default: true,
    },
  ]);
  assert.deepEqual(settings.extension, [
    { id: before.extension[0].id, value: 'CUSTOM', default: true },
  ]);
  assert.deepEqual(settings, before);
  assert.equal(
    (
      await client.execute(
        "SELECT is_active FROM qualities WHERE value='1080p'",
      )
    ).rows[0].is_active,
    0,
  );
});

test('concurrent creates and conflicting updates return 409 and preserve data', async (t) => {
  const client = await database(t);
  const service = new MoviesService(new MoviesRepository({ client }));
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

test('legacy duplicate provider IDs migrate without deleting records', async (t) => {
  const client = await database(t, false);
  await require('../src/database/legacy-schema').initializeDatabase(client);
  const { movieColumns, movieValues } = require('../src/database/movie-record');
  for (const id of ['a', 'b'])
    await client.execute({
      sql: `INSERT INTO movies(id,${movieColumns.join(',')}) VALUES(${Array(
        movieColumns.length + 1,
      )
        .fill('?')
        .join(',')})`,
      args: [id, ...movieValues(movie)],
    });
  await initializeDatabase(client);
  assert.equal(
    (await client.execute('SELECT COUNT(*) AS n FROM titles')).rows[0].n,
    2,
  );
  assert.equal(
    (await client.execute('SELECT COUNT(*) AS n FROM legacy_v2_movies')).rows[0]
      .n,
    2,
  );
  const service = new MoviesService(new MoviesRepository({ client }));
  await assert.rejects(service.create(movie), (e) => e.getStatus() === 409);
  const existing = await service.findOne('a');
  await service.update({ ...existing, name: 'Still preserved' });
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
      () => validateTitleQuery(query),
      (e) => e.getStatus() === 400,
    );
  }
  const valid = validateTitleQuery({
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
  const service = new MoviesService(new MoviesRepository({ client }));
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

test('JWT strategy validates subject and invalidates tokens after credential rotation', async () => {
  const {
    credentialVersion,
  } = require('../src/modules/auth/credential-version');
  let auth = { id: 'admin-id', secretKey: 'stored-hash' };
  const strategy = new JwtStrategy(
    { getOrThrow: () => 'test-only-secret' },
    {
      findSecretKey: async () => auth,
      isSessionActive: async () => true,
    },
  );
  const payload = {
    exp: Math.floor(Date.now() / 1000) + 3600,
    sub: auth.id,
    sid: 'test-session',
    credentialVersion: credentialVersion(auth.secretKey),
  };
  assert.deepEqual(await strategy.validate(payload), { userId: auth.id });
  for (const invalid of [
    null,
    {},
    { user: 'Administrator' },
    { ...payload, sub: 'other' },
    { ...payload, exp: undefined },
    { ...payload, exp: 0 },
  ]) {
    await assert.rejects(
      strategy.validate(invalid),
      (e) => e.getStatus() === 401,
    );
  }
  auth = { ...auth, secretKey: 'rotated-hash' };
  await assert.rejects(
    strategy.validate(payload),
    (e) => e.getStatus() === 401,
  );
});

test('settings rejects nonboolean defaults without changing existing data', async (t) => {
  const client = await database(t);
  const service = new SettingsService(new SettingsRepository({ client }));
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

test('body parsers validate nested values and preserve documented compatibility', () => {
  const {
    validateCreateMovie,
    validateUpdateMovie,
  } = require('../src/modules/movies/movie-validation');
  const {
    validateSettings,
    legacySettingsId,
  } = require('../src/modules/settings/settings-validation');
  const { validateLogin } = require('../src/modules/auth/login-validation');
  const bad = (e) => e.getStatus() === 400;
  assert.deepEqual(validateCreateMovie(movie), movie);
  assert.equal(
    validateUpdateMovie({ ...movie, id: 'legacy-mongo-id' }).id,
    'legacy-mongo-id',
  );
  for (const body of [
    null,
    {},
    { ...movie, year: [] },
    { ...movie, year: [2020, '2021'] },
    { ...movie, addedDate: '2026-02-30' },
    { ...movie, addedDate: '2026-01-01T24:00:00Z' },
    { ...movie, rating: -1 },
    { ...movie, genres: 'Drama' },
    { ...movie, actors: [{}] },
    { ...movie, posterUrl: 'javascript:alert(1)' },
    { ...movie, isSeries: 'false' },
    { ...movie, kpId: 1.5 },
    { ...movie, unexpected: true },
  ]) {
    assert.throws(() => validateCreateMovie(body), bad);
  }
  for (const body of [
    null,
    {},
    { secretKey: 42 },
    { secretKey: '' },
    { secretKey: 'é'.repeat(37) },
    { secretKey: 'test', extra: true },
  ]) {
    assert.throws(() => validateLogin(body), bad);
  }
  assert.deepEqual(validateLogin({ secretKey: ' spaces preserved ' }), {
    secretKey: ' spaces preserved ',
  });
  const settings = {
    quality: [{ title: 'Custom', value: 'CUSTOM', default: true }],
    extension: [{ value: 'CUSTOM', default: true }],
    genresForFilters: [],
  };
  assert.deepEqual(
    validateSettings({ ...settings, _id: legacySettingsId }),
    settings,
  );
  for (const body of [
    null,
    { ...settings, quality: [null] },
    {
      ...settings,
      quality: [
        { title: 'x', value: 'X', default: true },
        { title: 'y', value: ' x ' },
      ],
    },
    { ...settings, extension: [{ value: 'X', default: 'true' }] },
    { ...settings, genresForFilters: [42] },
    { ...settings, extra: true },
  ]) {
    assert.throws(() => validateSettings(body), bad);
  }
});

test('invalid movie writes and unsupported catalog values do not alter data', async (t) => {
  const client = await database(t);
  const service = new MoviesService(new MoviesRepository({ client }));
  await assert.rejects(
    service.create({ ...movie, rating: -1 }),
    (e) => e.getStatus() === 400,
  );
  await assert.rejects(
    service.create({ ...movie, quality: 'UNKNOWN' }),
    (e) => e.getStatus() === 400,
  );
  assert.equal(
    (await client.execute('SELECT COUNT(*) AS n FROM movie_catalog')).rows[0].n,
    0,
  );
  const created = await service.create(movie);
  await assert.rejects(
    service.update({ ...created, extension: 'UNKNOWN' }),
    (e) => e.getStatus() === 400,
  );
  assert.deepEqual(await service.findOne(created.id), created);
});

test('login limit is shared across instances, ignores forwarding headers and expires', async (t) => {
  const {
    LoginRateLimitGuard,
  } = require('../src/modules/auth/login-rate-limit.guard');
  const client = await database(t);
  const guards = [
    new LoginRateLimitGuard({ client }),
    new LoginRateLimitGuard({ client }),
  ];
  const headers = {};
  const context = {
    switchToHttp: () => ({
      getRequest: () => ({
        ip: '127.0.0.1',
        headers: { 'x-forwarded-for': Math.random().toString() },
      }),
      getResponse: () => ({
        setHeader: (key, value) => (headers[key] = value),
      }),
    }),
  };
  for (let i = 0; i < 10; i++)
    assert.equal(await guards[i % 2].canActivate(context), true);
  await assert.rejects(
    guards[0].canActivate(context),
    (e) => e.getStatus() === 429,
  );
  assert.ok(headers['Retry-After'] > 0);
  await client.execute('UPDATE login_attempts SET expires_at = 0');
  assert.equal(await guards[1].canActivate(context), true);
});

test('login validates credentials, signs expiring subject claims and rejects wrong secrets', async (t) => {
  const bcrypt = require('bcrypt');
  const { JwtService } = require('@nestjs/jwt');
  const { AuthService } = require('../src/modules/auth/auth.service');
  const client = await database(t);
  await client.execute({
    sql: 'INSERT INTO auth_credentials VALUES (?,?)',
    args: ['admin', await bcrypt.hash('test-secret', 4)],
  });
  const jwt = new JwtService({
    secret: 'test-only-secret',
    signOptions: { expiresIn: 3600 },
  });
  const service = new AuthService(
    new (require('../src/modules/auth/auth.repository').AuthRepository)({
      client,
    }),
    jwt,
    new (require('../src/modules/auth/refresh-session.repository').RefreshSessionRepository)(
      { client },
    ),
  );
  await assert.rejects(service.signIn(undefined), (e) => e.getStatus() === 400);
  await assert.rejects(service.signIn('wrong'), (e) => e.getStatus() === 401);
  const { access_token } = await service.signIn('test-secret');
  const payload = jwt.verify(access_token);
  assert.equal(payload.sub, 'admin');
  assert.equal(payload.exp - payload.iat, 3600);
  assert.equal(payload.secretKey, undefined);
  assert.equal(payload.credentialVersion.length, 64);
});

test('Unicode name and people search treats wildcard characters literally', async (t) => {
  const client = await database(t);
  const service = new MoviesService(new MoviesRepository({ client }));
  await service.create({
    ...movie,
    name: 'ТЕСТ 100%_done',
    actors: ['МЭТТ РОСС'],
    director: ['РЕЖИССЁР'],
  });
  assert.equal((await service.findAll({ search: 'тест' })).totalCount, 1);
  assert.equal(
    (await service.findAll({ actors: 'мэтт', directors: 'режиссёр' }))
      .totalCount,
    1,
  );
  assert.equal((await service.findAll({ search: '%_' })).totalCount, 1);
  assert.equal((await service.findAll({ search: '%no' })).totalCount, 0);
});

test('search migration backfills legacy records and validates text ledger', async (t) => {
  const { assertDatabaseVersion } = require('../src/database/schema');
  const client = await database(t, false);
  await require('../src/database/legacy-schema').initializeDatabase(client);
  const { movieColumns, movieValues } = require('../src/database/movie-record');
  await client.execute({
    sql: `INSERT INTO movies(id,${movieColumns.join(',')}) VALUES(${Array(
      movieColumns.length + 1,
    )
      .fill('?')
      .join(',')})`,
    args: ['old', ...movieValues({ ...movie, name: 'ТЕСТ', actors: ['МЭТТ'] })],
  });
  for (const column of [
    'name_search',
    'actors_search_json',
    'director_search_json',
  ])
    await client.execute(`ALTER TABLE movies DROP COLUMN ${column}`);
  await client.execute('DROP TABLE schema_migrations');
  await assert.rejects(assertDatabaseVersion(client), /migrations/);
  await initializeDatabase(client);
  await assertDatabaseVersion(client);
  const service = new MoviesService(new MoviesRepository({ client }));
  assert.equal(
    (await service.findAll({ search: 'тест', actors: 'мэтт' })).totalCount,
    1,
  );
});

test('configuration rejects missing secrets and exposes validated operational values', () => {
  const { validateEnvironment } = require('../src/config/environment');
  const base = { JWT_KEY: 'x'.repeat(32), TURSO_DATABASE_URL: 'file:local.db' };
  assert.throws(() => validateEnvironment({}), /JWT_KEY/);
  assert.throws(
    () => validateEnvironment({ ...base, PORT: 'invalid' }),
    /PORT/,
  );
  assert.throws(() => validateEnvironment({ ...base, CORS_ORIGINS: '*' }));
  assert.throws(() =>
    validateEnvironment({ ...base, DATABASE_AUTO_MIGRATE: 'yes' }),
  );
  const production = validateEnvironment({
    ...base,
    NODE_ENV: 'production',
    PORT: '8080',
  });
  assert.equal(production.DATABASE_AUTO_MIGRATE, false);
  assert.equal(production.PORT, 8080);
  assert.deepEqual(production.CORS_ORIGINS, [
    'https://cinema-catalogue.web.app',
  ]);
});

test('import validates duplicate IDs and rolls back all records on a late conflict', async (t) => {
  const {
    validateImportData,
    importBackups,
    parseImportArguments,
  } = require('../scripts/import-data');
  const bcrypt = require('bcrypt');
  const client = await database(t);
  const service = new MoviesService(new MoviesRepository({ client }));
  await service.create(movie);
  const id = '012345678901234567890123';
  const auth = [{ _id: { $oid: id }, secretKey: await bcrypt.hash('test', 4) }];
  const settings = [{ genresForFilters: ['Changed'] }];
  const backup = (kpId, id) => ({ ...movie, kpId, _id: { $oid: id } });
  assert.throws(
    () =>
      validateImportData(auth, settings, [
        backup(2, id),
        backup(2, '012345678901234567890124'),
      ]),
    /duplicate/,
  );
  const data = validateImportData(auth, settings, [
    backup(2, id),
    backup(1, '012345678901234567890124'),
  ]);
  await assert.rejects(importBackups(client, data), /same kpId/);
  assert.equal(
    (await client.execute('SELECT COUNT(*) AS n FROM auth_credentials')).rows[0]
      .n,
    0,
  );
  assert.equal(
    (await client.execute('SELECT COUNT(*) AS n FROM movie_catalog')).rows[0].n,
    1,
  );
  assert.equal(
    (
      await new SettingsService(
        new SettingsRepository({ client }),
      ).getSettings()
    ).genresForFilters.length,
    0,
  );
  assert.equal(
    parseImportArguments(['--movies', 'movies.json', '--repair-movies'])
      .repairMovies,
    true,
  );
  assert.throws(() => parseImportArguments(['--movies']), /filename/);
});

test('HTTP routes enforce body validation, authentication, revocation and login limits', async (t) => {
  const { NestFactory } = require('@nestjs/core');
  const { DatabaseService } = require('../src/database/database.service');
  const request = require('supertest');
  const bcrypt = require('bcrypt');
  const directory = mkdtempSync(join(tmpdir(), 'cinema-http-'));
  const overrides = {
    NODE_ENV: 'test',
    TURSO_REPLICA_PATH: '',
    JWT_KEY: 'test-only-key-with-at-least-32-bytes',
    TURSO_DATABASE_URL: `file:${join(directory, 'test.db')}`,
    DATABASE_AUTO_MIGRATE: 'true',
    PORT: '3000',
    TRUST_PROXY_HOPS: '0',
    CORS_ORIGINS: 'http://localhost:4200',
  };
  const saved = Object.fromEntries(
    Object.keys(overrides).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, overrides);
  let app;
  t.after(async () => {
    if (app) await app.close();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  });
  process.env.CORS_ORIGINS = 'http://localhost:4200';
  const { AppModule } = require('../src/app.module');
  app = await NestFactory.create(AppModule, {
    logger: false,
    abortOnError: false,
  });
  app.setGlobalPrefix('api');
  await app.init();
  await app.listen(0, '127.0.0.1');
  const db = app.get(DatabaseService).client;
  await db.execute({
    sql: 'INSERT INTO auth_credentials VALUES (?,?)',
    args: ['admin', await bcrypt.hash('test-secret', 4)],
  });
  const http = request(app.getHttpServer());
  await http
    .post('/api/auth')
    .set('Origin', 'http://localhost:4200')
    .set('X-MediaShelf-Request', '1')
    .send({})
    .expect(400);
  await http
    .post('/api/auth')
    .set('Origin', 'http://localhost:4200')
    .set('X-MediaShelf-Request', '1')
    .send({ secretKey: 'wrong' })
    .expect(401);
  const login = await http
    .post('/api/auth')
    .set('Origin', 'http://localhost:4200')
    .set('X-MediaShelf-Request', '1')
    .send({ secretKey: 'test-secret' })
    .expect(201);
  const token = login.body.access_token;
  await http.post('/api/movies').send(movie).expect(401);
  const {
    KinopoiskClient,
  } = require('../src/modules/kinopoisk/kinopoisk.client');
  let providerCalls = 0;
  app.get(KinopoiskClient).getMovie = async (id) => {
    providerCalls++;
    return {
      id,
      name: 'Provider title',
      persons: [{ enProfession: 'actor', enName: 'Actor' }],
      token: 'must-not-leak',
    };
  };
  await http
    .get('/api/kinopoisk/movies/301/autofill')
    .auth(token, { type: 'bearer' })
    .expect(404);
  await http.get('/api/kinopoisk/titles/301/autofill').expect(401);
  assert.equal(providerCalls, 0);
  await http
    .get('/api/kinopoisk/titles/NaN/autofill')
    .auth(token, { type: 'bearer' })
    .expect(400);
  const titleMetadata = await http
    .get('/api/kinopoisk/titles/301/autofill')
    .auth(token, { type: 'bearer' })
    .expect(200);
  assert.equal(titleMetadata.body.kpId, '301');
  assert.equal(titleMetadata.body.kind, null);
  assert.equal(titleMetadata.body.series, null);
  assert.equal(titleMetadata.body.formats, undefined);
  assert.equal(titleMetadata.body.addedDate, undefined);
  assert.equal(providerCalls, 1);
  await http
    .post('/api/movies')
    .auth(token, { type: 'bearer' })
    .send({ ...movie, rating: -1 })
    .expect(400);
  await http
    .post('/api/movies')
    .auth(token, { type: 'bearer' })
    .send(movie)
    .expect(201);
  await http
    .post('/api/movies')
    .auth(token, { type: 'bearer' })
    .send(movie)
    .expect(409);
  await http.get('/api/movies?pageSize=Infinity').expect(400);
  assert.equal(
    (await http.get('/api/movies?quality=1080p&quality=720p').expect(200)).body
      .totalCount,
    1,
  );
  assert.equal(
    (await http.get('/api/movies?quality=720p').expect(200)).body.totalCount,
    0,
  );
  assert.equal(
    (await http.get('/api/movies?ageRating=12&ageRating=16').expect(200)).body
      .totalCount,
    0,
  );
  await http.get('/api/movies?ageRating=bad').expect(400);
  const settings = await http.get('/api/settings').expect(200);
  await http
    .put('/api/settings')
    .auth(token, { type: 'bearer' })
    .send(settings.body)
    .expect(200);
  await http
    .put('/api/settings')
    .auth(token, { type: 'bearer' })
    .send({ ...settings.body, quality: [null] })
    .expect(400);
  const format = {
    qualityId: settings.body.quality.find((q) => q.value === '1080p').id,
    extensionId: settings.body.extension.find((e) => e.value === 'MKV').id,
  };
  const seriesInput = {
    name: 'HTTP series',
    addedDate: '2026-10-01',
    kpId: '1000',
    formats: [format],
    series: {
      startYear: 2020,
      productionStatus: 'in_production',
      seasons: [{ seasonNumber: 1, isAvailable: true, formats: [format] }],
    },
  };
  await http.post('/api/series').send(seriesInput).expect(401);
  await http
    .post('/api/wishlist/from-kinopoisk')
    .send({ kpId: '1000' })
    .expect(401);
  await http
    .post('/api/series')
    .auth(token, { type: 'bearer' })
    .send({ ...seriesInput, series: { endYear: 2010 } })
    .expect(400);
  const createdSeries = await http
    .post('/api/series')
    .auth(token, { type: 'bearer' })
    .send(seriesInput)
    .expect(201);
  assert.equal(createdSeries.body.availableSeasonCount, 1);
  await http.get('/api/series/' + createdSeries.body.id).expect(200);
  await http.get('/api/movies/' + createdSeries.body.id).expect(404);
  assert.equal(
    (await http.get('/api/series?quality=1080p').expect(200)).body.totalCount,
    1,
  );
  await http
    .put('/api/series/' + createdSeries.body.id)
    .send(seriesInput)
    .expect(401);
  await http
    .put('/api/series/' + createdSeries.body.id)
    .auth(token, { type: 'bearer' })
    .send({ ...seriesInput, name: 'Updated HTTP series' })
    .expect(200);
  await http.delete('/api/series/' + createdSeries.body.id).expect(401);
  const wishInput = {
    ...seriesInput,
    kind: 'series',
    kpId: '1001',
    releaseDate: '2027-01-01',
  };
  const { TitlesService } = require('../src/shared/titles/titles.service');
  const titles = app.get(TitlesService);
  const wish = { body: await titles.create(wishInput, 'wishlist') };
  assert.equal(wish.body.releaseDate, '2027-01-01');
  await http.get('/api/wishlist/' + wish.body.id).expect(200);
  assert.equal(
    (await http.get('/api/wishlist').expect(200)).body.totalCount,
    1,
  );
  await http
    .post('/api/wishlist/' + wish.body.id + '/refresh')
    .send({ kpId: '1001' })
    .expect(401);
  await http.delete('/api/wishlist/' + wish.body.id).expect(401);
  await http
    .post('/api/series')
    .auth(token, { type: 'bearer' })
    .send({
      ...seriesInput,
      kpId: '1001',
      wishlistId: wish.body.id,
      addedDate: '2027-02-30',
    })
    .expect(400);
  const promoted = await http
    .post('/api/series')
    .auth(token, { type: 'bearer' })
    .send({
      ...seriesInput,
      kpId: '1001',
      wishlistId: wish.body.id,
      releaseDate: '2027-01-01',
      addedDate: '2027-01-02',
    })
    .expect(201);
  assert.equal(promoted.body.id, wish.body.id);
  assert.equal(promoted.body.releaseDate, '2027-01-01');
  await http.get('/api/wishlist/' + wish.body.id).expect(404);
  await http
    .delete('/api/series/' + createdSeries.body.id)
    .auth(token, { type: 'bearer' })
    .expect(200);
  const toDelete = await titles.create(
    { kind: 'movie', name: 'Delete me', addedDate: '2026-10-01' },
    'wishlist',
  );
  await http
    .delete('/api/wishlist/' + toDelete.id)
    .auth(token, { type: 'bearer' })
    .expect(200);
  await db.execute({
    sql: 'UPDATE auth_credentials SET secret_key = ?',
    args: [await bcrypt.hash('new-secret', 4)],
  });
  await http
    .put('/api/settings')
    .auth(token, { type: 'bearer' })
    .send(settings.body)
    .expect(401);
  await http
    .get('/api/kinopoisk/titles/301/autofill')
    .auth(token, { type: 'bearer' })
    .expect(401);
  await http
    .get('/api/kinopoisk/titles/301/autofill')
    .auth(token, { type: 'bearer' })
    .expect(401);
  assert.equal(providerCalls, 1);
  for (let i = 0; i < 7; i++)
    await http
      .post('/api/auth')
      .set('Origin', 'http://localhost:4200')
      .set('X-MediaShelf-Request', '1')
      .send({ secretKey: 'wrong' })
      .expect(401);
  const limited = await http
    .post('/api/auth')
    .set('Origin', 'http://localhost:4200')
    .set('X-MediaShelf-Request', '1')
    .send({ secretKey: 'wrong' })
    .expect(429);
  assert.ok(Number(limited.headers['retry-after']) > 0);
});

test('migration refuses a newer text ledger without changing records', async (t) => {
  const client = await database(t);
  await client.execute(
    "INSERT INTO catalog_migrations VALUES('catalog-v99','future')",
  );
  await assert.rejects(initializeDatabase(client), /newer/);
  assert.equal(
    (await client.execute('SELECT COUNT(*) AS n FROM catalog_migrations'))
      .rows[0].n,
    7,
  );
});

test('imports share serialization, preserve custom catalogs and are idempotent', async (t) => {
  const {
    validateImportData,
    importBackups,
  } = require('../scripts/import-data');
  const bcrypt = require('bcrypt');
  const client = await database(t);
  await client.batch(
    replaceCatalogStatements(
      [{ value: 'CUSTOM', title: 'Custom', default: true }],
      [{ id: 'extension:435553544F4D', value: 'CUSTOM', default: true }],
    ),
    'write',
  );
  const id = '012345678901234567890123';
  const data = validateImportData(
    [{ _id: { $oid: id }, secretKey: await bcrypt.hash('test', 4) }],
    [{ genresForFilters: ['Drama'] }],
    [{ ...movie, name: 'ТЕСТ', _id: { $oid: id } }],
  );
  await importBackups(client, data);
  await importBackups(client, data);
  const service = new MoviesService(new MoviesRepository({ client }));
  const saved = await service.findOne(id);
  assert.equal(saved.name, 'ТЕСТ');
  assert.equal((await service.findAll({ search: 'тест' })).totalCount, 1);
  assert.equal(
    (
      await new SettingsService(
        new SettingsRepository({ client }),
      ).getSettings()
    ).quality[0].value,
    'CUSTOM',
  );
});

test('invalid stored JSON is rejected instead of violating the movie response type', async (t) => {
  const client = await database(t);
  const service = new MoviesService(new MoviesRepository({ client }));
  const created = await service.create(movie);
  await client.execute({
    sql: 'UPDATE titles SET genres_json = ? WHERE id = ?',
    args: ['"Drama"', created.id],
  });
  await assert.rejects(service.findOne(created.id), /Invalid stored JSON/);
});

test('frontend quality and age filters combine with a single matching release year', async (t) => {
  const client = await database(t);
  const service = new MoviesService(new MoviesRepository({ client }));
  await service.create({ ...movie, year: [1990, 2030], ageRating: 12 });
  const matching = await service.create({
    ...movie,
    kpId: 2,
    year: [2010, 2030],
    ageRating: 16,
  });
  await service.create({
    ...movie,
    kpId: 3,
    quality: '720p',
    ageRating: 16,
    year: 2010,
  });
  const query = {
    quality: ['1080p'],
    ageRating: ['12', '16'],
    fromYear: '2000',
    toYear: '2020',
  };
  assert.deepEqual(
    (await service.findAll(query)).list.map((item) => item.id),
    [matching.id],
  );
  assert.equal((await service.findAll({ quality: '720p' })).totalCount, 1);
  assert.equal((await service.findAll({ ageRating: '12' })).totalCount, 1);
  assert.deepEqual(validateTitleQuery({ genres: ' Drama,Comedy ' }).genres, [
    'Drama',
    'Comedy',
  ]);
  for (const invalid of [
    { ageRating: 'NaN' },
    { ageRating: '22' },
    { quality: [{}] },
    [],
  ]) {
    assert.throws(
      () => validateTitleQuery(invalid),
      (error) => error.getStatus() === 400,
    );
  }
});

test('storage decoding rejects invalid scalar movie fields', async (t) => {
  const client = await database(t);
  const service = new MoviesService(new MoviesRepository({ client }));
  const created = await service.create(movie);
  await client.execute({
    sql: 'UPDATE legacy_movie_values SET is_series = 2 WHERE title_id = ?',
    args: [created.id],
  });
  await assert.rejects(service.findOne(created.id), /Invalid stored movie/);
  await client.execute({
    sql: 'UPDATE legacy_movie_values SET is_series=NULL WHERE title_id=?',
    args: [created.id],
  });
  await client.execute({
    sql: 'UPDATE titles SET rating = 20 WHERE id = ?',
    args: [created.id],
  });
  await assert.rejects(service.findOne(created.id), /Invalid stored movie/);
});

test('startup refuses an incomplete migration ledger and closes failed clients', async (t) => {
  const { assertDatabaseVersion } = require('../src/database/schema');
  const { DatabaseService } = require('../src/database/database.service');
  const client = await database(t);
  await client.execute("DELETE FROM catalog_migrations WHERE id='catalog-v3'");
  await assert.rejects(assertDatabaseVersion(client), /schema version/);
  const service = new DatabaseService({
    get: (key) => (key === 'TURSO_DATABASE_URL' ? 'file::memory:' : undefined),
  });
  await assert.rejects(service.onModuleInit(), /migrations/);
  assert.equal(service.client.closed, true);
});

test('configuration and migration reject malformed sources before accepting them', async (t) => {
  const { validateEnvironment } = require('../src/config/environment');
  const base = { JWT_KEY: 'x'.repeat(32), TURSO_DATABASE_URL: 'file:local.db' };
  for (const url of [
    'libsql://',
    'https://',
    'file:',
    'https://user:password@example.com',
  ]) {
    assert.throws(
      () => validateEnvironment({ ...base, TURSO_DATABASE_URL: url }),
      /database URL/,
    );
  }
  assert.throws(
    () => validateEnvironment({ ...base, NODE_ENV: 'prod' }),
    /NODE_ENV/,
  );
  assert.throws(
    () =>
      validateEnvironment({
        ...base,
        NODE_ENV: 'production',
        TURSO_DATABASE_URL: 'libsql://example.com',
        TURSO_AUTH_TOKEN: ' ',
      }),
    /TURSO_AUTH_TOKEN/,
  );
  const client = await database(t, false);
  await legacy(
    client,
    '[{"value":"CUSTOM","title":"Custom","default":true},{"value":" custom ","title":"Duplicate"}]',
  );
  await assert.rejects(initializeDatabase(client), /Invalid legacy catalog/);
  assert.equal(
    (await client.execute('SELECT quality_json FROM settings')).rows.length,
    1,
  );
});

test('stored legacy metadata remains readable without relaxing new request validation', async (t) => {
  const client = await database(t);
  const service = new MoviesService(new MoviesRepository({ client }));
  const created = await service.create(movie);
  const longArtwork = 'https://example.com/' + 'x'.repeat(3000);
  await client.execute({
    sql: `UPDATE titles SET actors_json=?,director_json=?,sequels_and_prequels_json=?,similar_movies_json=?,compact_poster_url=? WHERE id=?`,
    args: ['["", "Actor"]', '[""]', '[""]', '[""]', longArtwork, created.id],
  });
  await client.execute({
    sql: 'UPDATE library_entries SET added_date=? WHERE title_id=?',
    args: ['legacy date', created.id],
  });
  const actual = await service.findOne(created.id);
  assert.deepEqual(actual.actors, ['', 'Actor']);
  assert.deepEqual(actual.director, ['']);
  assert.deepEqual(actual.sequelsAndPrequels, ['']);
  assert.deepEqual(actual.similarMovies, ['']);
  assert.equal(actual.compactPosterUrl, longArtwork);
  assert.equal(actual.addedDate, 'legacy date');
  const { id, ...input } = actual;
  void id;
  await assert.rejects(service.create(input), (e) => e.getStatus() === 400);
});

test('movie pagination selects indexed IDs before loading full metadata', async (t) => {
  const client = await database(t);
  const service = new MoviesService(new MoviesRepository({ client }));
  for (let i = 0; i < 35; i++) {
    await service.create({
      ...movie,
      kpId: i + 1,
      name: `Movie ${String(i).padStart(2, '0')}`,
      description: 'x'.repeat(10000),
    });
  }
  const statements = [];
  const proxy = {
    batch: async (sql, mode) => {
      statements.push(...sql);
      return client.batch(sql, mode);
    },
  };
  const paging = new MoviesService(new MoviesRepository({ client: proxy }));
  for (const direction of ['asc', 'desc']) {
    statements.length = 0;
    const result = await paging.findAll({ pageSize: 30, direction });
    assert.equal(result.totalCount, 35);
    assert.equal(result.list.length, 30);
    assert.equal(
      result.list[0].name,
      direction === 'asc' ? 'Movie 00' : 'Movie 34',
    );
    const page = statements[1];
    const plan = await client.execute({
      sql: `EXPLAIN QUERY PLAN ${page.sql}`,
      args: page.args,
    });
    const details = plan.rows.map((row) => String(row.detail));
    assert.ok(details.some((detail) => detail.includes('MATERIALIZE page')));
    assert.ok(
      details.some((detail) =>
        detail.includes('SEARCH t USING PRIMARY KEY (id=?)'),
      ),
    );
    assert.ok(details.some((detail) => detail.includes('titles_kind_name')));
    const pagePlan = await client.execute(
      `EXPLAIN QUERY PLAN SELECT id FROM movie_catalog ORDER BY name ${direction}, id ASC LIMIT 30`,
    );
    assert.ok(
      !pagePlan.rows.some((row) => String(row.detail).includes('TEMP B-TREE')),
    );
  }
  assert.equal(
    (await paging.findAll({ currentPage: 1, pageSize: 30 })).list.length,
    5,
  );
});

test('rating and year page selection uses sort indexes in both directions', async (t) => {
  const client = await database(t);
  for (const direction of ['ASC', 'DESC']) {
    for (const field of [
      'rating',
      "CASE json_type(year_json) WHEN 'array' THEN CAST(json_extract(year_json, '$[0]') AS INTEGER) ELSE CAST(year_json AS INTEGER) END",
    ]) {
      const plan = await client.execute(
        `EXPLAIN QUERY PLAN SELECT id FROM movie_catalog ORDER BY ${field} ${direction}, name ASC, id ASC LIMIT 30`,
      );
      assert.ok(
        plan.rows.some((row) =>
          String(row.detail).includes(
            field === 'rating' ? 'titles_kind_rating' : 'titles_kind_year',
          ),
        ),
      );
      assert.ok(
        !plan.rows.some((row) => String(row.detail).includes('TEMP B-TREE')),
      );
    }
  }
});
