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
  assert.deepEqual(await new KinopoiskService(client).getMovieAutofill(301), {
    actors: ['Keanu Reeves'],
    ageRating: 16,
    backdropUrl: 'https://images.example/backdrop.jpg',
    compactPosterUrl: 'https://images.example/preview.jpg',
    countries: ['США'],
    description: 'Описание',
    directors: ['Лана Вачовски'],
    enName: 'The Matrix',
    genres: ['фантастика'],
    kpId: 301,
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
  const result = await new KinopoiskService(client).getMovieAutofill(42);
  assert.equal(result.name, 'Fallback');
  assert.equal(result.enName, 'Fallback');
  assert.deepEqual(result.actors, []);
  assert.deepEqual(result.countries, []);
  assert.equal(result.posterUrl, '');
  assert.equal(result.year, undefined);
  assert.equal(result.rating, undefined);
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
      service.getMovieAutofill(301),
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
    getMovieAutofill: () => assert.fail('Invalid ID reached service'),
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
      () => controller.getMovieAutofill(id),
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
