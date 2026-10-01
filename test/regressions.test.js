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
  const settings = await new SettingsService(
    new SettingsRepository({ client }),
  ).getSettings();
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
    (
      await new SettingsService(
        new SettingsRepository({ client }),
      ).getSettings()
    ).quality,
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
    (
      await new SettingsService(
        new SettingsRepository({ client }),
      ).getSettings()
    ).extension,
    [{ value: 'CUSTOM', default: true }],
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

test('existing duplicates prevent unique-index migration without deleting movies', async (t) => {
  const client = await database(t);
  const service = new MoviesService(new MoviesRepository({ client }));
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
    },
  );
  const payload = {
    exp: Math.floor(Date.now() / 1000) + 3600,
    sub: auth.id,
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
    (await client.execute('SELECT COUNT(*) AS n FROM movies')).rows[0].n,
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
    sql: 'INSERT INTO auth VALUES (?,?)',
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

test('search migration backfills existing movies and records schema version', async (t) => {
  const { assertDatabaseVersion } = require('../src/database/schema');
  const client = await database(t);
  const service = new MoviesService(new MoviesRepository({ client }));
  await service.create({ ...movie, name: 'ТЕСТ', actors: ['МЭТТ'] });
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
  await assert.rejects(importBackups(client, data), /UNIQUE/);
  assert.equal(
    (await client.execute('SELECT COUNT(*) AS n FROM auth')).rows[0].n,
    0,
  );
  assert.equal(
    (await client.execute('SELECT COUNT(*) AS n FROM movies')).rows[0].n,
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
    sql: 'INSERT INTO auth VALUES (?,?)',
    args: ['admin', await bcrypt.hash('test-secret', 4)],
  });
  const http = request(app.getHttpServer());
  await http.post('/api/auth').send({}).expect(400);
  await http.post('/api/auth').send({ secretKey: 'wrong' }).expect(401);
  const login = await http
    .post('/api/auth')
    .send({ secretKey: 'test-secret' })
    .expect(201);
  const token = login.body.access_token;
  await http.post('/api/movies').send(movie).expect(401);
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
  await db.execute({
    sql: 'UPDATE auth SET secret_key = ?',
    args: [await bcrypt.hash('new-secret', 4)],
  });
  await http
    .put('/api/settings')
    .auth(token, { type: 'bearer' })
    .send(settings.body)
    .expect(401);
  for (let i = 0; i < 7; i++)
    await http.post('/api/auth').send({ secretKey: 'wrong' }).expect(401);
  const limited = await http
    .post('/api/auth')
    .send({ secretKey: 'wrong' })
    .expect(429);
  assert.ok(Number(limited.headers['retry-after']) > 0);
});

test('migration refuses a newer database schema without modifying its records', async (t) => {
  const client = await database(t);
  await client.execute("INSERT INTO schema_migrations VALUES(99, 'future')");
  await assert.rejects(initializeDatabase(client), /newer/);
  assert.equal(
    (
      await client.execute(
        'SELECT MAX(version) AS version FROM schema_migrations',
      )
    ).rows[0].version,
    99,
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
      [{ value: 'CUSTOM', default: true }],
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
    sql: 'UPDATE movies SET genres_json = ? WHERE id = ?',
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
  assert.deepEqual(validateMovieQuery({ genres: ' Drama,Comedy ' }).genres, [
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
      () => validateMovieQuery(invalid),
      (error) => error.getStatus() === 400,
    );
  }
});

test('storage decoding rejects invalid scalar movie fields', async (t) => {
  const client = await database(t);
  const service = new MoviesService(new MoviesRepository({ client }));
  const created = await service.create(movie);
  await client.execute({
    sql: 'UPDATE movies SET is_series = 2 WHERE id = ?',
    args: [created.id],
  });
  await assert.rejects(service.findOne(created.id), /Invalid stored movie/);
  await client.execute({
    sql: 'UPDATE movies SET is_series = NULL, rating = 20 WHERE id = ?',
    args: [created.id],
  });
  await assert.rejects(service.findOne(created.id), /Invalid stored movie/);
});

test('startup refuses an incomplete migration ledger and closes failed clients', async (t) => {
  const { assertDatabaseVersion } = require('../src/database/schema');
  const { DatabaseService } = require('../src/database/database.service');
  const client = await database(t);
  await client.execute('DELETE FROM schema_migrations WHERE version = 1');
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
