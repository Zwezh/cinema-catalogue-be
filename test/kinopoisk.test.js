const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  KinopoiskClient,
} = require('../src/modules/kinopoisk/kinopoisk.client');
const {
  KinopoiskService,
} = require('../src/modules/kinopoisk/kinopoisk.service');
const {
  KinopoiskController,
} = require('../src/modules/kinopoisk/kinopoisk.controller');
const { validateEnvironment } = require('../src/config/environment');

const provider = {
  id: 301,
  name: ' Матрица ',
  alternativeName: 'The Matrix',
  ageRating: 16,
  year: 1999,
  movieLength: 136,
  rating: { kp: 8.5 },
  description: ' Описание ',
  genres: [{ name: 'фантастика' }, { name: 'фантастика' }, { name: '' }],
  countries: [{ name: 'США' }],
  persons: [
    { enProfession: ' Director ', name: 'Лана Вачовски' },
    { enProfession: 'actor', enName: 'Keanu Reeves' },
    { enProfession: 'actor', enName: 'Keanu Reeves' },
    { enProfession: 'producer', name: 'Excluded' },
  ],
  poster: {
    url: 'https://images.example/poster.jpg',
    previewUrl: 'https://images.example/preview.jpg',
  },
  backdrop: { previewUrl: 'https://images.example/backdrop.jpg' },
  similarMovies: [{ alternativeName: 'Dark City' }],
  sequelsAndPrequels: [{ name: 'Матрица: Перезагрузка' }],
  secret: 'provider-only-field',
};

const config = { get: () => 'test-provider-token' };

test('provider parsing and mapping preserve autofill fields and exclude unrelated data', async () => {
  const client = new KinopoiskClient(config, async (url, options) => {
    assert.equal(url, 'https://api.poiskkino.dev/v1.4/movie/301');
    assert.equal(options.headers['X-API-KEY'], 'test-provider-token');
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json(provider);
  });
  assert.deepEqual(await new KinopoiskService(client).getTitleAutofill(301), {
    actors: ['Keanu Reeves'],
    ageRating: 16,
    backdropUrl: 'https://images.example/backdrop.jpg',
    compactPosterUrl: 'https://images.example/preview.jpg',
    countries: ['США'],
    description: 'Описание',
    directors: ['Лана Вачовски'],
    enName: 'The Matrix',
    genres: ['фантастика'],
    kpId: '301',
    kind: null,
    series: null,
    releaseDate: null,
    movieLength: 136,
    name: 'Матрица',
    posterUrl: 'https://images.example/poster.jpg',
    rating: 8.5,
    sequelsAndPrequels: ['Матрица: Перезагрузка'],
    similarMovies: ['Dark City'],
    year: 1999,
  });
});

test('nullable provider metadata maps to empty fields without clearing editor values', async () => {
  const client = new KinopoiskClient(config, async () =>
    Response.json({
      id: 42,
      alternativeName: 'Fallback',
      countries: null,
      persons: null,
      year: null,
      rating: null,
      poster: null,
    }),
  );
  const result = await new KinopoiskService(client).getTitleAutofill(42);
  assert.equal(result.name, 'Fallback');
  assert.equal(result.enName, 'Fallback');
  assert.deepEqual(result.actors, []);
  assert.deepEqual(result.countries, []);
  assert.equal(result.posterUrl, '');
  assert.equal(result.year, null);
  assert.equal(result.rating, null);
});

test('invalid provider data fails atomically with a sanitized gateway error', async () => {
  for (const value of [
    null,
    {},
    { id: 302 },
    { id: 301, persons: [null] },
    { id: 301, rating: { kp: 'oops' } },
    { id: 0 },
    { id: 301.5 },
  ]) {
    const service = new KinopoiskService(
      new KinopoiskClient(config, async () => Response.json(value)),
    );
    await assert.rejects(
      service.getTitleAutofill(301),
      (error) =>
        error.getStatus() === 502 &&
        !JSON.stringify(error.getResponse()).includes('test-provider-token'),
    );
  }
});

test('provider status and transport errors do not expose keys or log users out', async () => {
  for (const [status, expected] of [
    [404, 404],
    [401, 502],
    [403, 502],
    [429, 502],
    [500, 502],
    [302, 502],
  ]) {
    const client = new KinopoiskClient(
      config,
      async () => new Response('test-provider-token', { status }),
    );
    await assert.rejects(
      client.getMovie(301),
      (error) =>
        error.getStatus() === expected &&
        !JSON.stringify(error.getResponse()).includes('test-provider-token'),
    );
  }
  const failed = new KinopoiskClient(config, async () => {
    throw new Error('secret: test-provider-token');
  });
  await assert.rejects(
    failed.getMovie(301),
    (error) =>
      error.getStatus() === 502 &&
      !error.message.includes('test-provider-token'),
  );
  const timeout = new KinopoiskClient(config, async () => {
    throw new DOMException('secret: test-provider-token', 'TimeoutError');
  });
  await assert.rejects(
    timeout.getMovie(301),
    (error) => error.getStatus() === 504,
  );
});

test('malformed and oversized JSON are rejected and provider bodies are cancelled', async () => {
  for (const body of [
    'invalid JSON test-provider-token',
    'x'.repeat(2 * 1024 * 1024 + 1),
  ]) {
    const response = new Response(body);
    const client = new KinopoiskClient(config, async () => response);
    await assert.rejects(
      client.getMovie(301),
      (error) => error.getStatus() === 502,
    );
    assert.equal(response.body.locked, false);
  }
});

test('missing credentials and invalid IDs never make provider requests', async () => {
  const client = new KinopoiskClient({ get: () => undefined }, async () =>
    assert.fail('Unexpected provider request'),
  );
  await assert.rejects(
    client.getMovie(1),
    (error) => error.getStatus() === 503,
  );
  const controller = new KinopoiskController({
    getTitleAutofill: () => assert.fail('Invalid ID reached service'),
  });
  for (const id of [
    '0',
    '-1',
    '1.5',
    '1e3',
    ' 1',
    'https://example.com',
    '9007199254740992',
  ]) {
    assert.throws(
      () => controller.getTitleAutofill(id),
      (error) => error.getStatus() === 400,
    );
  }
  const base = { JWT_KEY: 'x'.repeat(32), TURSO_DATABASE_URL: 'file:test.db' };
  for (const token of ['', ' ', 'token\nheader', 42]) {
    assert.throws(
      () => validateEnvironment({ ...base, KINOPOISK_API_TOKEN: token }),
      /KINOPOISK_API_TOKEN/,
    );
  }
  assert.equal(
    validateEnvironment({ ...base, KINOPOISK_API_TOKEN: 'test-token' })
      .KINOPOISK_API_TOKEN,
    'test-token',
  );
});

const emptySeasonPage = { docs: [], hasNext: false, next: null };

const seriesProvider = {
  ...provider,
  isSeries: true,
  type: 'tv-series',
  status: 'filming',
  year: 2020,
  movieLength: null,
  seriesLength: 45,
  premiere: { world: '2020-03-15T00:00:00.000Z' },
  releaseYears: [{ start: 2020, end: null }],
  seasonsInfo: [
    { number: 2 },
    { number: 0 },
    { number: 1 },
    { number: 1 },
    { number: null },
  ],
};

test('title autofill maps provider series metadata without inventing local availability or formats', async () => {
  const service = new KinopoiskService(
    new KinopoiskClient(config, async (url) =>
      Response.json(
        url.includes('/season?') ? emptySeasonPage : seriesProvider,
      ),
    ),
  );
  const result = await service.getTitleAutofill(301);
  assert.equal(result.kind, 'series');
  assert.equal(result.kpId, '301');
  assert.equal(result.year, 2020);
  assert.equal(result.movieLength, 45);
  assert.equal(result.releaseDate, '2020-03-15');
  assert.deepEqual(result.series, {
    startYear: 2020,
    endYear: null,
    productionStatus: 'in_production',
    announcedSeasonCount: null,
    seasons: [0, 1, 2].map((seasonNumber) => ({
      seasonNumber,
      releaseYear: null,
    })),
  });
  assert.equal(result.formats, undefined);
  assert.equal(result.addedDate, undefined);
  assert.equal(result.availableSeasonCount, undefined);
  assert.equal(result.series.seasons[0].isAvailable, undefined);
  assert.equal(result.secret, undefined);
});

test('finished series and missing optional title metadata remain compatible with draft contracts', async () => {
  const service = new KinopoiskService(
    new KinopoiskClient(config, async (url) =>
      Response.json(
        url.includes('/season?')
          ? emptySeasonPage
          : {
              ...seriesProvider,
              isSeries: null,
              status: 'completed',
              releaseYears: [{ start: 2020, end: 2024 }],
            },
      ),
    ),
  );
  const result = await service.getTitleAutofill(301);
  assert.deepEqual(result.year, [2020, 2024]);
  assert.equal(result.series.productionStatus, 'finished');
  assert.equal(result.series.endYear, 2024);
  const unknown = await new KinopoiskService(
    new KinopoiskClient(config, async () => Response.json({ id: 301 })),
  ).getTitleAutofill(301);
  assert.equal(unknown.kind, null);
  assert.equal(unknown.series, null);
  for (const field of [
    'ageRating',
    'year',
    'movieLength',
    'rating',
    'releaseDate',
  ])
    assert.equal(unknown[field], null);
  const movie = await new KinopoiskService(
    new KinopoiskClient(config, async () =>
      Response.json({
        ...provider,
        isSeries: false,
        premiere: { world: '2020-02-30' },
      }),
    ),
  ).getTitleAutofill(301);
  assert.equal(movie.kind, 'movie');
  assert.equal(movie.series, null);
  assert.equal(movie.releaseDate, null);
});

test('title autofill rejects malformed provider series data with sanitized errors', async () => {
  for (const fields of [
    { isSeries: 'true' },
    { seriesLength: -1 },
    { releaseYears: [{ start: '2020' }] },
    { releaseYears: [{ start: 2025, end: 2020 }] },
    { seasonsInfo: [{ number: -1 }] },
    { seasonsInfo: [null] },
    { seasonsInfo: Array(1001).fill({ number: 1 }) },
    { releaseYears: Array(201).fill({ start: 2020 }) },
    { premiere: { world: 2020 } },
  ]) {
    const service = new KinopoiskService(
      new KinopoiskClient(config, async () =>
        Response.json({ ...seriesProvider, ...fields }),
      ),
    );
    await assert.rejects(
      service.getTitleAutofill(301),
      (error) =>
        error.getStatus() === 502 &&
        !error.message.includes('test-provider-token'),
    );
  }
});

test('title controller validates IDs before requesting metadata', () => {
  const controller = new KinopoiskController({
    getTitleAutofill: () => assert.fail('Invalid ID reached service'),
  });
  for (const id of ['0', '-1', '1.5', '1e3', ' 1', '9007199254740992'])
    assert.throws(
      () => controller.getTitleAutofill(id),
      (error) => error.getStatus() === 400,
    );
});

test('normalized title metadata can produce a valid series or wishlist collection DTO', async () => {
  const { validateTitle } = require('../src/shared/titles/title-validation');
  for (const film of [seriesProvider, { ...provider, isSeries: false }]) {
    const autofill = await new KinopoiskService(
      new KinopoiskClient(config, async (url) =>
        Response.json(url.includes('/season?') ? emptySeasonPage : film),
      ),
    ).getTitleAutofill(301);
    const { directors, ...metadata } = autofill;
    const payload = {
      ...metadata,
      director: directors,
      addedDate: '2026-10-05',
      formats: [],
      series: autofill.series
        ? {
            ...autofill.series,
            seasons: autofill.series.seasons.map((season) => ({
              ...season,
              isAvailable: false,
              formats: [],
            })),
          }
        : null,
    };
    const validated = validateTitle(payload, film.isSeries);
    assert.equal(validated.kind, film.isSeries ? 'series' : 'movie');
    assert.equal(validated.kpId, '301');
    assert.deepEqual(validated.director, autofill.directors);
  }
  const inconsistent = await new KinopoiskService(
    new KinopoiskClient(config, async (url) =>
      Response.json(
        url.includes('/season?')
          ? emptySeasonPage
          : {
              ...seriesProvider,
              status: 'completed',
              releaseYears: [{ start: null, end: 2010 }],
            },
      ),
    ),
  ).getTitleAutofill(301);
  assert.equal(inconsistent.series.startYear, 2020);
  assert.equal(inconsistent.series.endYear, null);
  assert.equal(inconsistent.year, 2020);
});

test('series season cursor pages enrich dates, retain undated numbers and keep requests on the fixed host', async () => {
  const calls = [];
  const cursor = 'opaque&movieId=999/https://example.com';
  const service = new KinopoiskService(
    new KinopoiskClient(config, async (url, options) => {
      calls.push({ url, signal: options.signal });
      if (url.includes('/movie/')) return Response.json(seriesProvider);
      const parsed = new URL(url);
      assert.equal(parsed.origin, 'https://api.poiskkino.dev');
      assert.equal(parsed.pathname, '/v1.5/season');
      assert.equal(parsed.searchParams.get('movieId'), '301');
      assert.equal(parsed.searchParams.get('limit'), '250');
      assert.deepEqual(parsed.searchParams.getAll('selectFields'), [
        'movieId',
        'number',
        'airDate',
      ]);
      assert.equal(options.headers['X-API-KEY'], 'test-provider-token');
      assert.equal(options.redirect, 'error');
      if (!parsed.searchParams.has('next'))
        return Response.json({
          docs: [
            { movieId: 301, number: 0, airDate: null },
            { movieId: 301, number: 1, airDate: '2020-03-15T00:00:00Z' },
          ],
          hasNext: true,
          next: cursor,
        });
      assert.equal(parsed.searchParams.get('next'), cursor);
      return Response.json({
        docs: [{ movieId: 301, number: 3, airDate: '2024-12-31' }],
        hasNext: false,
        next: null,
      });
    }),
  );
  const result = await service.getTitleAutofill(301);
  assert.deepEqual(result.series.seasons, [
    { seasonNumber: 0, releaseYear: null },
    { seasonNumber: 1, releaseYear: 2020 },
    { seasonNumber: 2, releaseYear: null },
    { seasonNumber: 3, releaseYear: 2024 },
  ]);
  assert.equal(calls.length, 3);
  assert.equal(calls[1].signal, calls[2].signal);
});

test('invalid season pages fail atomically with sanitized errors', async () => {
  for (const page of [
    null,
    {},
    { docs: [], hasNext: true, next: null },
    { docs: [{ movieId: 302, number: 1 }], hasNext: false },
    { docs: [{ movieId: 301, number: -1 }], hasNext: false },
    {
      docs: [{ movieId: 301, number: 1, airDate: '2020-02-30' }],
      hasNext: false,
    },
    { docs: [{ movieId: 301, number: 1, airDate: 2020 }], hasNext: false },
    { docs: Array(251).fill({ movieId: 301, number: 1 }), hasNext: false },
  ]) {
    const service = new KinopoiskService(
      new KinopoiskClient(config, async (url) =>
        Response.json(url.includes('/movie/') ? seriesProvider : page),
      ),
    );
    await assert.rejects(
      service.getTitleAutofill(301),
      (error) =>
        error.getStatus() === 502 &&
        !error.message.includes('test-provider-token'),
    );
  }
});

test('cursor repetition and excessive pagination never return partial season metadata', async () => {
  for (const repeat of [true, false]) {
    let pages = 0;
    const service = new KinopoiskService(
      new KinopoiskClient(config, async (url) => {
        if (url.includes('/movie/')) return Response.json(seriesProvider);
        pages++;
        return Response.json({
          docs: [],
          hasNext: true,
          next: repeat ? 'same' : String(pages),
        });
      }),
    );
    await assert.rejects(
      service.getTitleAutofill(301),
      (error) => error.getStatus() === 502,
    );
    assert.equal(pages, repeat ? 2 : 4);
  }
});

test('season provider credential failures and timeouts retain sanitized gateway statuses', async () => {
  for (const expected of [502, 504]) {
    const service = new KinopoiskService(
      new KinopoiskClient(config, async (url) => {
        if (url.includes('/movie/')) return Response.json(seriesProvider);
        if (expected === 504) throw new DOMException('secret', 'TimeoutError');
        return new Response('secret', { status: 401 });
      }),
    );
    await assert.rejects(
      service.getTitleAutofill(301),
      (error) =>
        error.getStatus() === expected && !error.message.includes('secret'),
    );
  }
});

test('season duplicates preserve known years and reject conflicting provider years', async () => {
  for (const conflict of [false, true]) {
    const service = new KinopoiskService(
      new KinopoiskClient(config, async (url) =>
        Response.json(
          url.includes('/movie/')
            ? seriesProvider
            : {
                docs: [
                  { movieId: 301, number: 1, airDate: '2020-03-15' },
                  {
                    movieId: 301,
                    number: 1,
                    airDate: conflict ? '2021-03-15' : null,
                  },
                ],
                hasNext: false,
              },
        ),
      ),
    );
    if (conflict)
      await assert.rejects(
        service.getTitleAutofill(301),
        (error) => error.getStatus() === 502,
      );
    else
      assert.deepEqual(
        (await service.getTitleAutofill(301)).series.seasons.find(
          (season) => season.seasonNumber === 1,
        ),
        { seasonNumber: 1, releaseYear: 2020 },
      );
  }
});

test('the final season union cannot exceed the editor contract limit', async () => {
  const service = new KinopoiskService(
    new KinopoiskClient(config, async (url) =>
      Response.json(
        url.includes('/movie/')
          ? {
              ...seriesProvider,
              seasonsInfo: Array.from({ length: 1000 }, (_, number) => ({
                number,
              })),
            }
          : {
              docs: [{ movieId: 301, number: 1000, airDate: null }],
              hasNext: false,
            },
      ),
    ),
  );
  await assert.rejects(
    service.getTitleAutofill(301),
    (error) => error.getStatus() === 502,
  );
});

test('915196 imports all five seasons even when the movie response omits seasonsInfo', async () => {
  const requests = [];
  const airDates = [
    '2016-07-15',
    '2017-10-27',
    '2019-07-04',
    '2022-05-27',
    '2025-11-26',
  ];
  const client = new KinopoiskClient(config, async (url) => {
    requests.push(url);
    if (url.includes('/movie/'))
      return Response.json({
        id: 915196,
        isSeries: true,
        name: 'Очень странные дела',
        status: 'completed',
        releaseYears: [{ start: 2016, end: 2025 }],
      });
    const query = new URL(url);
    assert.equal(query.pathname, '/v1.5/season');
    assert.equal(query.searchParams.get('movieId'), '915196');
    return Response.json({
      docs: airDates
        .map((date, index) => ({
          movieId: 915196,
          number: index + 1,
          airDate: date + 'T00:00:00.000Z',
        }))
        .reverse(),
      limit: 250,
      next: null,
      prev: null,
      hasNext: false,
      hasPrev: false,
    });
  });
  const result = await new KinopoiskService(client).getTitleAutofill(915196);
  assert.equal(requests.length, 2);
  assert.deepEqual(result.series.seasons, [
    { seasonNumber: 1, releaseYear: 2016 },
    { seasonNumber: 2, releaseYear: 2017 },
    { seasonNumber: 3, releaseYear: 2019 },
    { seasonNumber: 4, releaseYear: 2022 },
    { seasonNumber: 5, releaseYear: 2025 },
  ]);
});

test('ongoing provider series normalize the zero end-year sentinel without inventing a finished range', async () => {
  for (const [id, start, seriesLength] of [
    [1044004, 2019, 60],
    [1355059, 2020, 47],
    [1199731, 2024, 0],
    [6058297, 2025, 50],
  ]) {
    const service = new KinopoiskService(
      new KinopoiskClient(config, async (url) =>
        Response.json(
          url.includes('/movie/')
            ? {
                id,
                isSeries: true,
                year: start,
                releaseYears: [{ start, end: 0 }],
                seriesLength,
              }
            : {
                docs: [{ movieId: id, number: 1, airDate: start + '-01-01' }],
                hasNext: false,
                next: null,
              },
        ),
      ),
    );
    const result = await service.getTitleAutofill(id);
    assert.equal(result.kpId, String(id));
    assert.equal(result.year, start);
    assert.equal(result.series.startYear, start);
    assert.equal(result.series.endYear, null);
    assert.equal(result.series.productionStatus, 'in_production');
    assert.equal(result.movieLength, seriesLength || null);
    assert.deepEqual(result.series.seasons, [
      { seasonNumber: 1, releaseYear: start },
    ]);
  }
});

test('zero year normalization remains specific to provider range boundaries', async () => {
  const {
    parseKinopoiskFilm,
  } = require('../src/modules/kinopoisk/kinopoisk.parser');
  for (const fields of [
    { year: 0 },
    { releaseYears: [{ start: -1, end: 0 }] },
    { releaseYears: [{ start: '0', end: 0 }] },
    { releaseYears: [{ start: 2024.5, end: 0 }] },
    { releaseYears: [{ start: 10000, end: 0 }] },
    { releaseYears: [{ start: 2024, end: -1 }] },
    { releaseYears: [{ start: 2024, end: '0' }] },
    { releaseYears: [{ start: 2024, end: 2020 }] },
  ])
    assert.throws(
      () => parseKinopoiskFilm({ id: 1199731, ...fields }),
      TypeError,
    );
  const active = await new KinopoiskService(
    new KinopoiskClient(config, async (url) =>
      Response.json(
        url.includes('/movie/')
          ? {
              id: 1199731,
              isSeries: true,
              status: 'filming',
              releaseYears: [{ start: 2024, end: 0 }],
            }
          : emptySeasonPage,
      ),
    ),
  ).getTitleAutofill(1199731);
  assert.equal(active.series.productionStatus, 'in_production');
  assert.equal(active.series.endYear, null);
});

test('series status inference uses open ranges only when explicit production status is absent', () => {
  const {
    parseKinopoiskFilm,
  } = require('../src/modules/kinopoisk/kinopoisk.parser');
  const {
    toTitleAutofill,
  } = require('../src/modules/kinopoisk/title-autofill.mapper');
  for (const [fields, status, endYear] of [
    [{ releaseYears: [{ start: 2025, end: null }] }, 'in_production', null],
    [
      { status: null, releaseYears: [{ start: 2025, end: 0 }] },
      'in_production',
      null,
    ],
    [{ releaseYears: [{ start: 2020, end: 2024 }] }, 'finished', 2024],
    [
      { status: 'completed', releaseYears: [{ start: 2025, end: 0 }] },
      'finished',
      null,
    ],
    [
      { status: 'filming', releaseYears: [{ start: 2025, end: 2025 }] },
      'in_production',
      null,
    ],
    [
      { status: 'cancelled', releaseYears: [{ start: 2025, end: 0 }] },
      'unknown',
      null,
    ],
    [{ year: 2025 }, 'unknown', null],
    [{ releaseYears: [{ start: null, end: null }] }, 'unknown', null],
    [
      {
        releaseYears: [
          { start: 2020, end: 2023 },
          { start: 2025, end: 0 },
        ],
      },
      'in_production',
      null,
    ],
  ]) {
    const result = toTitleAutofill(
      parseKinopoiskFilm({ id: 6058297, isSeries: true, ...fields }),
    );
    assert.equal(
      result.series.productionStatus,
      status,
      JSON.stringify(fields),
    );
    assert.equal(result.series.endYear, endYear, JSON.stringify(fields));
  }
});

test('12935736 with both provider range boundaries unknown supports autofill and Wishlist mapping', async () => {
  const {
    providerWishlist,
  } = require('../src/modules/wishlist/provider-wishlist');
  const requests = [];
  const service = new KinopoiskService(
    new KinopoiskClient(config, async (url) => {
      requests.push(url);
      return Response.json(
        url.includes('/movie/')
          ? {
              id: 12935736,
              name: 'Универ. 17 лет спустя',
              type: 'tv-series',
              isSeries: true,
              year: null,
              status: null,
              releaseYears: [{ start: 0, end: 0 }],
              seasonsInfo: null,
              seriesLength: null,
              premiere: null,
            }
          : emptySeasonPage,
      );
    }),
  );
  const result = await service.getTitleAutofill(12935736);
  assert.equal(requests.length, 2);
  assert.equal(result.kpId, '12935736');
  assert.equal(result.kind, 'series');
  assert.equal(result.name, 'Универ. 17 лет спустя');
  assert.equal(result.year, null);
  assert.deepEqual(result.series, {
    startYear: null,
    endYear: null,
    productionStatus: 'unknown',
    announcedSeasonCount: null,
    seasons: [],
  });
  const draft = providerWishlist(result);
  assert.equal(draft.kpId, '12935736');
  assert.equal(draft.series.startYear, null);
  assert.equal(draft.series.endYear, null);
});

test('unknown provider start sentinel retains a known fallback year and explicit production status', () => {
  const {
    parseKinopoiskFilm,
  } = require('../src/modules/kinopoisk/kinopoisk.parser');
  const {
    toTitleAutofill,
  } = require('../src/modules/kinopoisk/title-autofill.mapper');
  const result = toTitleAutofill(
    parseKinopoiskFilm({
      id: 12935736,
      isSeries: true,
      year: 2027,
      status: 'announced',
      releaseYears: [{ start: 0, end: 0 }],
    }),
  );
  assert.equal(result.year, 2027);
  assert.equal(result.series.startYear, 2027);
  assert.equal(result.series.endYear, null);
  assert.equal(result.series.productionStatus, 'in_production');
});
