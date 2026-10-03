const { WishlistService } = require('../src/modules/wishlist/wishlist.service');
const { TitlesService } = require('../src/shared/titles/titles.service');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createClient } = require('@libsql/client');
const {
  initializeDatabase,
  assertDatabaseVersion,
} = require('../src/database/schema');
const {
  TitlesRepository,
} = require('../src/database/titles/titles.repository');
const {
  SettingsRepository,
} = require('../src/modules/settings/settings.repository');
const { SettingsService } = require('../src/modules/settings/settings.service');
const { MoviesRepository } = require('../src/modules/movies/movies.repository');
const { MoviesService } = require('../src/modules/movies/movies.service');
const { validateTitle } = require('../src/shared/titles/title-validation');

const draft = {
  kind: 'series',
  name: 'Future series',
  addedDate: '2026-10-01',
  kpId: '500',
};
async function setup(t, initialize = true) {
  const dir = mkdtempSync(join(tmpdir(), 'catalog-v3-test-'));
  const client = createClient({ url: `file:${join(dir, 'test.db')}` });
  t.after(() => {
    client.close();
    rmSync(dir, { recursive: true, force: true });
  });
  if (initialize) await initializeDatabase(client);
  const titles = new TitlesService(new TitlesRepository({ client }));
  const wishlist = new WishlistService(titles);
  return {
    client,
    catalog: {
      create: titles.create.bind(titles),
      update: titles.update.bind(titles),
      findOne: titles.findOne.bind(titles),
      findAll: titles.findAll.bind(titles),
      delete: titles.delete.bind(titles),
      promote: wishlist.promote.bind(wishlist),
    },
    settings: new SettingsService(new SettingsRepository({ client })),
    movies: new MoviesService(new MoviesRepository({ client })),
  };
}
function payload(title) {
  const { id, availableSeasonCount, ...input } = title;
  void id;
  void availableSeasonCount;
  return input;
}
function pickFormats(settings) {
  return [
    {
      qualityId: settings.quality.find((q) => q.value === '1080p').id,
      extensionId: settings.extension.find((e) => e.value === 'MKV').id,
    },
    {
      qualityId: settings.quality.find((q) => q.value === '2160p').id,
      extensionId: settings.extension.find((e) => e.value === 'MP4').id,
    },
  ];
}

test('series CRUD supports seasons, available count, multiple formats and indexed filters', async (t) => {
  const { client, catalog, settings, movies } = await setup(t);
  const formats = pickFormats(await settings.getSettings());
  const title = await catalog.create(
    {
      ...draft,
      genres: ['Drama'],
      actors: ['МЭТТ РОСС'],
      year: [2020, 2025],
      formats,
      series: {
        startYear: 2020,
        endYear: 2025,
        productionStatus: 'finished',
        announcedSeasonCount: 4,
        seasons: [
          { seasonNumber: 0, isAvailable: true, formats: [formats[0]] },
          { seasonNumber: 1, releaseYear: 2020, isAvailable: true, formats },
          { seasonNumber: 2, isAvailable: false },
          { seasonNumber: 4, isAvailable: true },
        ],
      },
    },
    'library',
    true,
  );
  assert.equal(title.availableSeasonCount, 2);
  assert.equal(title.series.productionStatus, 'finished');
  assert.equal(title.formats.length, 2);
  assert.equal(title.series.seasons[1].formats.length, 2);
  assert.equal((await movies.findAll({})).totalCount, 0);
  assert.equal(
    (
      await catalog.findAll(
        {
          genres: 'Drama',
          actors: 'мэтт',
          quality: '2160p',
          fromYear: 2025,
          toYear: 2025,
        },
        'library',
        true,
      )
    ).totalCount,
    1,
  );
  const before = (
    await client.execute(
      'SELECT id,season_number FROM seasons ORDER BY season_number',
    )
  ).rows;
  const updated = await catalog.update(
    title.id,
    {
      ...payload(title),
      series: {
        ...title.series,
        seasons: title.series.seasons.map((s) => ({
          ...s,
          isAvailable: s.seasonNumber !== 0,
        })),
      },
    },
    'library',
    true,
  );
  assert.equal(updated.availableSeasonCount, 3);
  assert.deepEqual(
    (
      await client.execute(
        'SELECT id,season_number FROM seasons ORDER BY season_number',
      )
    ).rows,
    before,
  );
  assert.equal((await catalog.delete(title.id, 'library', true)).id, title.id);
  for (const table of [
    'titles',
    'series_details',
    'seasons',
    'season_formats',
    'title_formats',
    'title_genres',
  ])
    assert.equal(
      (await client.execute(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n,
      0,
    );
});

test('wishlist promotion retains IDs, release dates, metadata and all formats atomically', async (t) => {
  const { catalog, settings } = await setup(t);
  const formats = pickFormats(await settings.getSettings());
  const title = await catalog.create(
    {
      ...draft,
      releaseDate: '2027-01-01',
      formats,
      series: {
        productionStatus: 'in_production',
        seasons: [{ seasonNumber: 1, isAvailable: false }],
      },
    },
    'wishlist',
  );
  const promoted = await catalog.promote(title.id, '2027-01-02');
  assert.equal(promoted.id, title.id);
  assert.equal(promoted.addedDate, '2027-01-02');
  assert.equal(promoted.releaseDate, '2027-01-01');
  assert.deepEqual(promoted.formats, title.formats);
  assert.equal((await catalog.findAll({}, 'wishlist')).totalCount, 0);
  assert.equal((await catalog.findAll({}, 'library', true)).totalCount, 1);
  await assert.rejects(
    catalog.promote(title.id, '2027-01-02'),
    (e) => e.getStatus() === 404,
  );
});

test('incomplete movie wishlist cannot be promoted, complete one stays compatible with movie API', async (t) => {
  const { catalog, settings, movies } = await setup(t);
  const title = await catalog.create(
    { kind: 'movie', name: 'Future movie', addedDate: '2026-10-01' },
    'wishlist',
  );
  assert.equal(title.kpId, null);
  assert.equal(title.rating, null);
  assert.equal(title.year, null);
  await assert.rejects(
    catalog.promote(title.id, '2027-01-02'),
    (e) => e.getStatus() === 400,
  );
  assert.equal((await catalog.findAll({}, 'wishlist')).totalCount, 1);
  await catalog.update(
    title.id,
    {
      ...payload(title),
      kpId: '501',
      year: 2027,
      movieLength: 120,
      rating: 8,
      releaseDate: '2027-01-01',
      formats: pickFormats(await settings.getSettings()),
    },
    'wishlist',
  );
  await catalog.promote(title.id, '2027-01-02');
  const movie = await movies.findOne(title.id);
  assert.equal(movie.kpId, 501);
  assert.equal(movie.name, 'Future movie');
});

test('retiring catalogs preserves existing formats and rejects new assignments', async (t) => {
  const { client, catalog, settings } = await setup(t);
  const original = await settings.getSettings();
  const formats = pickFormats(original);
  const title = await catalog.create(
    {
      ...draft,
      formats,
      series: { seasons: [{ seasonNumber: 1, isAvailable: true, formats }] },
    },
    'library',
    true,
  );
  await settings.update({
    quality: [{ value: 'NEW', title: 'New quality', default: true }],
    extension: [{ value: 'NEW', default: true }],
    genresForFilters: [],
  });
  await catalog.update(title.id, payload(title), 'library', true);
  await assert.rejects(
    catalog.create({ ...draft, kpId: '502', formats }, 'library', true),
    (e) => e.getStatus() === 400,
  );
  assert.equal(
    (await client.execute('SELECT COUNT(*) AS n FROM titles')).rows[0].n,
    1,
  );
  assert.equal(
    (await catalog.findOne(title.id, 'library', true)).formats.length,
    2,
  );
  assert.deepEqual(
    await client.execute('PRAGMA foreign_key_check').then((r) => r.rows),
    [],
  );
  assert.equal(
    (await settings.getCatalogs()).quality.find(
      (q) => q.id === formats[0].qualityId,
    ).isActive,
    false,
  );
});

test('bad nested formats and duplicate seasons roll back every metadata change', async (t) => {
  const { catalog, settings } = await setup(t);
  const title = await catalog.create(
    { ...draft, formats: pickFormats(await settings.getSettings()) },
    'library',
    true,
  );
  await assert.rejects(
    catalog.update(
      title.id,
      {
        ...payload(title),
        name: 'Must roll back',
        series: {
          seasons: [
            {
              seasonNumber: 1,
              isAvailable: true,
              formats: [{ qualityId: 'missing', extensionId: 'missing' }],
            },
          ],
        },
      },
      'library',
      true,
    ),
    (e) => e.getStatus() === 400,
  );
  assert.deepEqual(await catalog.findOne(title.id, 'library', true), title);
  await assert.rejects(
    catalog.update(
      title.id,
      {
        ...payload(title),
        series: {
          seasons: [
            { seasonNumber: 1, isAvailable: true },
            { seasonNumber: 1, isAvailable: false },
          ],
        },
      },
      'library',
      true,
    ),
    (e) => e.getStatus() === 400,
  );
  assert.deepEqual(await catalog.findOne(title.id, 'library', true), title);
});

test('cross-collection provider conflicts are serialized and do not leave orphan records', async (t) => {
  const { client, catalog } = await setup(t);
  const results = await Promise.allSettled([
    catalog.create(draft, 'wishlist'),
    catalog.create(draft, 'library', true),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(
    results.find((r) => r.status === 'rejected').reason.getStatus(),
    409,
  );
  assert.equal(
    (await client.execute('SELECT COUNT(*) AS n FROM titles')).rows[0].n,
    1,
  );
});

test('new request validation rejects invalid dates, status, field types and forged IDs', () => {
  const bad = (e) => e.getStatus() === 400;
  for (const input of [
    { ...draft, releaseDate: '2026-02-30' },
    { ...draft, kpId: 500 },
    { ...draft, series: { productionStatus: 'ongoing' } },
    {
      ...draft,
      series: { startYear: 2025, endYear: 2020, productionStatus: 'finished' },
    },
    { ...draft, series: { endYear: 2026 } },
    {
      ...draft,
      series: { seasons: [{ seasonNumber: -1, isAvailable: true }] },
    },
    {
      ...draft,
      series: { seasons: [{ seasonNumber: 1, isAvailable: 'yes' }] },
    },
    {
      ...draft,
      formats: [
        { qualityId: 'id', extensionId: 'id' },
        { qualityId: 'id', extensionId: 'id' },
      ],
    },
    { ...draft, formats: [{ qualityId: 1, extensionId: 'id' }] },
    { ...draft, secret: true },
    { ...draft, kind: 'movie', series: {} },
    { ...draft, kind: 'movie' },
  ]) {
    assert.throws(() => validateTitle(input, true), bad);
  }
});

test('integrated migration preserves original JSON, flags, fields and archives original tables', async (t) => {
  const { client, catalog, movies } = await setup(t, false);
  await require('../src/database/legacy-schema').initializeDatabase(client);
  const { movieColumns, movieValues } = require('../src/database/movie-record');
  const legacy = {
    addedDate: '2020-01-01',
    ageRating: null,
    backdropUrl: '',
    compactPosterUrl: '',
    countries: ['PL'],
    description: 'Details',
    director: ['Director'],
    enName: 'English',
    extension: 'OLD',
    genres: ['Drama', 'Drama'],
    isSeries: true,
    kpId: 501,
    posterUrl: '',
    name: 'Series',
    movieLength: 50,
    actors: ['Actor', 'Actor'],
    quality: 'OLD',
    rating: 7,
    year: [2020, 2022],
    sequelsAndPrequels: ['External'],
    similarMovies: ['Related'],
  };
  await client.execute({
    sql: `INSERT INTO movies(id,${movieColumns.join(',')}) VALUES(${Array(
      movieColumns.length + 1,
    )
      .fill('?')
      .join(',')})`,
    args: ['original', ...movieValues(legacy)],
  });
  await client.execute('UPDATE movies SET countries_json=\'[ "PL" ]\'');
  await initializeDatabase(client);
  await initializeDatabase(client);
  await assertDatabaseVersion(client);
  const title = await catalog.findOne('original', 'library', true);
  assert.deepEqual(title.actors, legacy.actors);
  assert.deepEqual(title.genres, legacy.genres);
  assert.equal(title.series.productionStatus, 'unknown');
  assert.equal(title.availableSeasonCount, 0);
  assert.equal((await movies.findAll({})).totalCount, 0);
  assert.equal(
    (
      await client.execute(
        "SELECT countries_json FROM titles WHERE id='original'",
      )
    ).rows[0].countries_json,
    '[ "PL" ]',
  );
  assert.equal(
    (await client.execute('SELECT COUNT(*) AS n FROM legacy_v2_movies')).rows[0]
      .n,
    1,
  );
  assert.equal(
    (await client.execute('SELECT is_series FROM legacy_movie_values')).rows[0]
      .is_series,
    1,
  );
  const legacyInitializer =
    require('../src/database/legacy-schema').initializeDatabase;
  await assert.rejects(legacyInitializer(client));
});

test('already-applied standalone migration can finish backend integration', async (t) => {
  const { client } = await setup(t, false);
  await require('../src/database/legacy-schema').initializeDatabase(client);
  const tx = await client.transaction('write');
  try {
    await tx.executeMultiple(
      readFileSync(join(__dirname, '../database-v3/schema.sql'), 'utf8'),
    );
    await tx.executeMultiple(
      readFileSync(join(__dirname, '../database-v3/migrate.sql'), 'utf8'),
    );
    await tx.execute("INSERT INTO schema_migrations VALUES(3,'test')");
    await tx.commit();
  } finally {
    tx.close();
  }
  await client.execute('DROP TABLE login_attempts');
  await initializeDatabase(client);
  await assertDatabaseVersion(client);
  const {
    LoginRateLimitGuard,
  } = require('../src/modules/auth/login-rate-limit.guard');
  const guard = new LoginRateLimitGuard({ client });
  assert.equal(
    await guard.canActivate({
      switchToHttp: () => ({
        getRequest: () => ({ ip: '127.0.0.1' }),
        getResponse: () => ({ setHeader() {} }),
      }),
    }),
    true,
  );
});

test('catalog pages load formats and seasons with a bounded number of SQL statements', async (t) => {
  const { client, catalog } = await setup(t);
  for (let i = 0; i < 3; i++)
    await catalog.create(
      {
        ...draft,
        kpId: String(800 + i),
        name: `Series ${i}`,
        series: {
          seasons: Array.from({ length: 12 }, (_, n) => ({
            seasonNumber: n + 1,
            isAvailable: true,
          })),
        },
      },
      'library',
      true,
    );
  let statements = 0;
  const measured = new TitlesRepository({
    client: {
      transaction: async (mode) => {
        const tx = await client.transaction(mode);
        return new Proxy(tx, {
          get(target, key) {
            const member = target[key];
            if (key === 'execute')
              return (...args) => {
                statements++;
                return member.apply(target, args);
              };
            if (key === 'batch')
              return (...args) => {
                statements += args[0].length;
                return member.apply(target, args);
              };
            return typeof member === 'function' ? member.bind(target) : member;
          },
        });
      },
    },
  });
  const page = await new TitlesService(measured).findAll({}, 'library', true);
  assert.equal(page.list.length, 3);
  assert.equal(
    page.list.every((s) => s.series.seasons.length === 12),
    true,
  );
  assert.ok(
    statements <= 15,
    `Expected batched reads; observed ${statements} statements`,
  );
});

test('provider aliases are canonical and conflict across collections, including stored aliases', async (t) => {
  const { client, catalog } = await setup(t);
  const first = await catalog.create(
    { ...draft, kpId: ' 0001 ' },
    'library',
    true,
  );
  assert.equal(first.kpId, '1');
  await assert.rejects(
    catalog.create({ ...draft, kpId: '01' }, 'wishlist'),
    (e) => e.getStatus() === 409,
  );
  await client.execute({
    sql: 'UPDATE titles SET kp_id=? WHERE id=?',
    args: ['0001', first.id],
  });
  await assert.rejects(
    catalog.create({ ...draft, kpId: '1' }, 'wishlist'),
    (e) => e.getStatus() === 409,
  );
  const updated = await catalog.update(
    first.id,
    { ...payload(first), kpId: '01' },
    'library',
    true,
  );
  assert.equal(updated.kpId, '1');
  for (const kpId of ['0', '-1', '1.1', '1e2', 'abc', '9007199254740992'])
    assert.throws(
      () => validateTitle({ ...draft, kpId }),
      (e) => e.getStatus() === 400,
    );
});

test('promotion rejects historical provider aliases without losing either title', async (t) => {
  const { client, catalog } = await setup(t);
  await catalog.create({ ...draft, kpId: '1' }, 'library', true);
  const wish = await catalog.create({ ...draft, kpId: '2' }, 'wishlist');
  await client.execute({
    sql: 'UPDATE titles SET kp_id=? WHERE id=?',
    args: ['01', wish.id],
  });
  await assert.rejects(
    catalog.promote(wish.id, '2026-10-02'),
    (e) => e.getStatus() === 409,
  );
  assert.equal((await catalog.findAll({}, 'wishlist')).totalCount, 1);
  assert.equal((await catalog.findAll({}, 'library', true)).totalCount, 1);
  assert.equal(
    (await client.execute('SELECT COUNT(*) AS n FROM titles')).rows[0].n,
    2,
  );
});

test('Unicode settings round trip with bounded new IDs and compatible legacy IDs', async (t) => {
  const { client, catalog, settings } = await setup(t);
  const value = 'Ж'.repeat(100);
  const configured = await settings.update({
    quality: [{ value, title: 'Unicode', default: true }],
    extension: [{ value, default: true }],
    genresForFilters: [],
  });
  assert.ok(configured.quality[0].id.length < 100);
  assert.deepEqual(await settings.update(configured), configured);
  const title = await catalog.create(
    {
      ...draft,
      formats: [
        {
          qualityId: configured.quality[0].id,
          extensionId: configured.extension[0].id,
        },
      ],
    },
    'wishlist',
  );
  assert.equal(title.formats.length, 1);
  const legacyQuality = `quality:${Buffer.from(value).toString('hex').toUpperCase()}`;
  await client.execute({
    sql: 'INSERT INTO qualities(id,value,title,is_active) VALUES(?,?,?,1)',
    args: [legacyQuality, 'Legacy unicode', 'Legacy'],
  });
  const old = await catalog.create(
    {
      ...draft,
      kpId: '501',
      formats: [
        { qualityId: legacyQuality, extensionId: configured.extension[0].id },
      ],
    },
    'wishlist',
  );
  assert.equal(old.formats[0].qualityId, legacyQuality);
});

test('movie quality filters match all formats after wishlist promotion', async (t) => {
  const { catalog, settings, movies } = await setup(t);
  const formats = pickFormats(await settings.getSettings());
  const title = await catalog.create(
    {
      ...draft,
      kind: 'movie',
      year: 2026,
      movieLength: 120,
      rating: 8,
      formats,
    },
    'wishlist',
  );
  await catalog.promote(title.id, '2026-10-02');
  assert.equal((await movies.findAll({ quality: '1080p' })).totalCount, 1);
  assert.equal((await movies.findAll({ quality: '2160p' })).totalCount, 1);
});

test('provider sorting is numeric for text IDs', async (t) => {
  const { catalog } = await setup(t);
  for (const kpId of ['100', '20', '3'])
    await catalog.create({ ...draft, kpId }, 'wishlist');
  assert.deepEqual(
    (await catalog.findAll({ key: 'kpId' }, 'wishlist')).list.map(
      (title) => title.kpId,
    ),
    ['3', '20', '100'],
  );
});

test('metadata-only series updates use bounded SQL and never rewrite unchanged seasons', async (t) => {
  const { client, catalog, settings } = await setup(t);
  const formats = pickFormats(await settings.getSettings());
  const title = await catalog.create(
    {
      ...draft,
      series: {
        seasons: Array.from({ length: 100 }, (_, i) => ({
          seasonNumber: i + 1,
          releaseYear: 2026,
          isAvailable: true,
          formats,
        })),
      },
    },
    'library',
    true,
  );
  await client.executeMultiple(`CREATE TABLE season_changes(n INTEGER); INSERT INTO season_changes VALUES(0);
    CREATE TRIGGER changed_season_update AFTER UPDATE ON seasons BEGIN UPDATE season_changes SET n=n+1; END;
    CREATE TRIGGER changed_season_delete AFTER DELETE ON seasons BEGIN UPDATE season_changes SET n=n+1; END;
    CREATE TRIGGER changed_season_insert AFTER INSERT ON seasons BEGIN UPDATE season_changes SET n=n+1; END;`);
  let statements = 0,
    calls = 0;
  const measured = new TitlesService(
    new TitlesRepository({
      client: {
        transaction: async (mode) => {
          const tx = await client.transaction(mode);
          return new Proxy(tx, {
            get(target, key) {
              const member = target[key];
              if (key === 'execute' || key === 'batch')
                return (...args) => {
                  calls++;
                  statements += key === 'batch' ? args[0].length : 1;
                  return member.apply(target, args);
                };
              return typeof member === 'function'
                ? member.bind(target)
                : member;
            },
          });
        },
      },
    }),
  );
  await measured.update(
    title.id,
    { ...payload(title), name: 'Renamed only' },
    'library',
    true,
  );
  assert.ok(statements < 30, `Observed ${statements} statements`);
  assert.ok(calls < 20, `Observed ${calls} round trips`);
  assert.equal(
    (await client.execute('SELECT n FROM season_changes')).rows[0].n,
    0,
  );
  const changed = payload(title);
  changed.series.seasons = changed.series.seasons.filter(
    (s) => s.seasonNumber !== 100,
  );
  changed.series.seasons[0] = {
    ...changed.series.seasons[0],
    isAvailable: false,
    formats: [formats[0]],
  };
  const result = await catalog.update(title.id, changed, 'library', true);
  assert.equal(result.series.seasons.length, 99);
  assert.equal(result.availableSeasonCount, 98);
  assert.equal(result.series.seasons[0].formats.length, 1);
  assert.equal(
    (await client.execute('SELECT n FROM season_changes')).rows[0].n,
    2,
  );
  assert.deepEqual((await client.execute('PRAGMA foreign_key_check')).rows, []);
});

test('v4 upgrade preserves title data and catalog IDs and indexes canonical provider lookups', async (t) => {
  const { client, catalog, settings } = await setup(t);
  const configured = await settings.getSettings();
  const title = await catalog.create(
    { ...draft, formats: pickFormats(configured) },
    'wishlist',
  );
  const before = (await client.execute('SELECT * FROM titles')).rows;
  await client.executeMultiple(
    "DELETE FROM catalog_migrations WHERE id IN ('catalog-v4-provider-index','catalog-v5-page-indexes','catalog-v6-sort-indexes'); DROP INDEX idx_titles_provider_canonical; DROP TABLE login_attempts; DROP INDEX titles_kind_name; DROP INDEX titles_kind_name_desc; DROP INDEX titles_kind_rating; DROP INDEX titles_kind_rating_desc; DROP INDEX titles_kind_year; DROP INDEX titles_kind_year_desc;",
  );
  await assert.rejects(assertDatabaseVersion(client), /schema version/);
  await initializeDatabase(client);
  await initializeDatabase(client);
  assert.deepEqual((await client.execute('SELECT * FROM titles')).rows, before);
  assert.deepEqual(await settings.getSettings(), configured);
  assert.deepEqual(await catalog.findOne(title.id, 'wishlist'), title);
  const plan = await client.execute({
    sql: "EXPLAIN QUERY PLAN SELECT id FROM titles WHERE kp_id IS NOT NULL AND trim(kp_id)<>'' AND trim(kp_id) NOT GLOB '*[^0-9]*' AND CAST(kp_id AS INTEGER)=CAST(? AS INTEGER) AND id<>? LIMIT 1",
    args: ['500', 'other'],
  });
  assert.ok(
    plan.rows.some((row) =>
      String(row.detail).includes('idx_titles_provider_canonical'),
    ),
  );
  assert.equal(
    (await client.execute('SELECT COUNT(*) AS n FROM catalog_migrations'))
      .rows[0].n,
    4,
  );
  await assertDatabaseVersion(client);
});

test('legacy series unknown year bounds survive reads without changing stored JSON', async (t) => {
  const { client, catalog } = await setup(t);
  const title = await catalog.create(
    { ...draft, year: [2020] },
    'library',
    true,
  );
  await client.execute({
    sql: 'UPDATE titles SET year_json=? WHERE id=?',
    args: ['[2020,null]', title.id],
  });
  const actual = await catalog.findOne(title.id, 'library', true);
  assert.deepEqual(actual.year, [2020, null]);
  assert.equal(
    (
      await client.execute({
        sql: 'SELECT year_json FROM titles WHERE id=?',
        args: [title.id],
      })
    ).rows[0].year_json,
    '[2020,null]',
  );
  assert.throws(
    () => validateTitle({ ...draft, year: [2020, null] }),
    (e) => e.getStatus() === 400,
  );
});
