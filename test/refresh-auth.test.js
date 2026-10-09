const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('@libsql/client');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { initializeDatabase } = require('../src/database/schema');
const {
  RefreshSessionRepository,
} = require('../src/modules/auth/refresh-session.repository');
const { AuthRequestGuard } = require('../src/modules/auth/auth-request.guard');
const { AuthService } = require('../src/modules/auth/auth.service');
const { AuthRepository } = require('../src/modules/auth/auth.repository');
const { AuthController } = require('../src/modules/auth/auth.controller');
const { JwtStrategy } = require('../src/modules/auth/jwt-strategy');
const { JwtService } = require('@nestjs/jwt');
const bcrypt = require('bcrypt');

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'refresh-auth-'));
  const client = createClient({ url: `file:${join(directory, 'test.db')}` });
  t.after(() => {
    client.close();
    rmSync(directory, { recursive: true, force: true });
  });
  await initializeDatabase(client);
  await client.execute({
    sql: 'INSERT INTO auth_credentials VALUES (?,?)',
    args: ['admin', await bcrypt.hash('test-secret', 4)],
  });
  const sessions = new RefreshSessionRepository({ client });
  const jwt = new JwtService({
    secret: 'test-only-secret',
    signOptions: { expiresIn: 900 },
  });
  const service = new AuthService(
    new AuthRepository({ client }),
    jwt,
    sessions,
  );
  return { client, sessions, jwt, service };
}

test('refresh tokens are hashed, rotated and bounded by the original 30-day deadline', async (t) => {
  const { client, sessions, jwt, service } = await fixture(t);
  const signedIn = await service.signIn('test-secret');
  const payload = jwt.verify(signedIn.access_token);
  assert.equal(payload.exp - payload.iat, 900);
  assert.equal(payload.sid, signedIn.session.id);
  assert.ok(signedIn.session.expiresAt > Date.now() + 29 * 86400000);
  assert.ok(signedIn.session.expiresAt <= Date.now() + 30 * 86400000);
  const stored = await client.execute('SELECT * FROM auth_refresh_tokens');
  assert.equal(
    JSON.stringify(stored.rows).includes(signedIn.session.token),
    false,
  );
  const refreshed = await service.refresh(signedIn.session.token);
  assert.notEqual(refreshed.session.token, signedIn.session.token);
  assert.equal(refreshed.session.expiresAt, signedIn.session.expiresAt);
  assert.equal(refreshed.session.id, signedIn.session.id);
  assert.equal(
    await sessions.isActive(payload.sid, 'admin', payload.credentialVersion),
    true,
  );
  // Replaying a consumed token invalidates the whole family, including the new JWT.
  await assert.rejects(
    service.refresh(signedIn.session.token),
    (e) => e.getStatus() === 401,
  );
  assert.equal(
    await sessions.isActive(payload.sid, 'admin', payload.credentialVersion),
    false,
  );
  await assert.rejects(
    service.refresh(refreshed.session.token),
    (e) => e.getStatus() === 401,
  );
});

test('logout and credential changes revoke refresh sessions and protected access', async (t) => {
  const { service, jwt, client } = await fixture(t);
  const strategy = new JwtStrategy(
    { getOrThrow: () => 'test-only-secret' },
    service,
  );
  const login = await service.signIn('test-secret');
  assert.deepEqual(await strategy.validate(jwt.verify(login.access_token)), {
    userId: 'admin',
  });
  await service.logout(login.session.token);
  await assert.rejects(
    strategy.validate(jwt.verify(login.access_token)),
    (e) => e.getStatus() === 401,
  );
  await assert.rejects(
    service.refresh(login.session.token),
    (e) => e.getStatus() === 401,
  );
  const another = await service.signIn('test-secret');
  await client.execute({
    sql: 'UPDATE auth_credentials SET secret_key=?',
    args: [await bcrypt.hash('new-secret', 4)],
  });
  await assert.rejects(
    service.refresh(another.session.token),
    (e) => e.getStatus() === 401,
  );
  await assert.rejects(
    strategy.validate(jwt.verify(another.access_token)),
    (e) => e.getStatus() === 401,
  );
});

test('expired, malformed and concurrent refresh attempts cannot create usable sessions', async (t) => {
  const { service, client, sessions, jwt } = await fixture(t);
  const login = await service.signIn('test-secret');
  const attempts = await Promise.allSettled([
    service.refresh(login.session.token),
    service.refresh(login.session.token),
  ]);
  assert.equal(
    attempts.filter((result) => result.status === 'fulfilled').length,
    1,
  );
  const payload = jwt.verify(login.access_token);
  assert.equal(
    await sessions.isActive(
      payload.sid,
      payload.sub,
      payload.credentialVersion,
    ),
    false,
  );
  const expired = await service.signIn('test-secret');
  await client.execute({
    sql: 'UPDATE auth_refresh_tokens SET expires_at=0 WHERE session_id=?',
    args: [expired.session.id],
  });
  for (const token of [expired.session.token, '', 'x'.repeat(10000)])
    await assert.rejects(service.refresh(token), (e) => e.getStatus() === 401);
});

test('auth CSRF checks require an allowed origin and custom header', () => {
  const guard = new AuthRequestGuard({
    getOrThrow: () => ['https://app.example'],
  });
  const context = (headers) => ({
    switchToHttp: () => ({
      getRequest: () => ({ get: (name) => headers[name] }),
    }),
  });
  assert.equal(
    guard.canActivate(
      context({ Origin: 'https://app.example', 'X-MediaShelf-Request': '1' }),
    ),
    true,
  );
  for (const headers of [
    {},
    { Origin: 'https://evil.example', 'X-MediaShelf-Request': '1' },
    { Origin: 'https://app.example' },
    { 'X-MediaShelf-Request': '1' },
  ])
    assert.throws(
      () => guard.canActivate(context(headers)),
      (e) => e.getStatus() === 403,
    );
});

test('production cookie is host-only, HttpOnly, Secure and never appears in the JSON response', async (t) => {
  const { service } = await fixture(t);
  const config = { get: () => 'production', getOrThrow: () => 'lax' };
  const controller = new AuthController(service, config);
  const calls = [];
  const response = {
    setHeader: (name, value) => calls.push([name, value]),
    cookie: (...args) => calls.push(args),
  };
  const body = await controller.signIn({ secretKey: 'test-secret' }, response);
  assert.deepEqual(Object.keys(body), ['access_token']);
  const cookie = calls.find((row) => row[0] === '__Host-media-shelf-refresh');
  assert.ok(cookie);
  assert.deepEqual(cookie[2], {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: cookie[2].maxAge,
  });
  assert.ok(cookie[2].maxAge <= 30 * 86400000);
});

test('HTTP login, cookie rotation, replay rejection and logout enforce the complete browser contract', async (t) => {
  const { NestFactory } = require('@nestjs/core');
  const { DatabaseService } = require('../src/database/database.service');
  const request = require('supertest');
  const directory = mkdtempSync(join(tmpdir(), 'refresh-http-'));
  const saved = { ...process.env };
  Object.assign(process.env, {
    JWT_KEY: 'a'.repeat(32),
    TURSO_DATABASE_URL: `file:${join(directory, 'test.db')}`,
    DATABASE_AUTO_MIGRATE: 'true',
    NODE_ENV: 'test',
    CORS_ORIGINS: 'http://localhost:4200',
    TURSO_REPLICA_PATH: '',
    REFRESH_COOKIE_SAMESITE: 'lax',
  });
  const { AppModule } = require('../src/app.module');
  const app = await NestFactory.create(AppModule, {
    logger: false,
    abortOnError: false,
  });
  t.after(async () => {
    await app.close();
    process.env = saved;
    rmSync(directory, { recursive: true, force: true });
  });
  app.setGlobalPrefix('api');
  await app.init();
  const db = app.get(DatabaseService).client;
  await db.execute({
    sql: 'INSERT INTO auth_credentials VALUES (?,?)',
    args: ['admin', await bcrypt.hash('secret', 4)],
  });
  const http = request(app.getHttpServer());
  const browser = (path) =>
    http
      .post(path)
      .set('Origin', 'http://localhost:4200')
      .set('X-MediaShelf-Request', '1');
  await http.post('/api/auth').send({ secretKey: 'secret' }).expect(403);
  await http
    .post('/api/auth/refresh')
    .set('Origin', 'https://evil.example')
    .set('X-MediaShelf-Request', '1')
    .expect(403);
  const login = await browser('/api/auth')
    .send({ secretKey: 'secret' })
    .expect(201);
  assert.deepEqual(Object.keys(login.body), ['access_token']);
  assert.equal(login.headers['cache-control'], 'no-store');
  const cookie = login.headers['set-cookie'][0];
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  const maxAge = Number(/Max-Age=(\d+)/.exec(cookie)?.[1]);
  assert.ok(maxAge > 2591900 && maxAge <= 2592000);
  const refreshed = await browser('/api/auth/refresh')
    .set('Cookie', cookie.split(';')[0])
    .send({})
    .expect(200);
  const rotated = refreshed.headers['set-cookie'][0].split(';')[0];
  assert.notEqual(rotated, cookie.split(';')[0]);
  await browser('/api/auth/refresh')
    .set('Cookie', cookie.split(';')[0])
    .send({})
    .expect(401);
  await browser('/api/auth/refresh')
    .set('Cookie', rotated)
    .send({})
    .expect(401);
  await http
    .get('/api/kinopoisk/titles/301/autofill')
    .auth(refreshed.body.access_token, { type: 'bearer' })
    .expect(401);
  const again = await browser('/api/auth')
    .send({ secretKey: 'secret' })
    .expect(201);
  const logout = await browser('/api/auth/logout')
    .set('Cookie', again.headers['set-cookie'][0].split(';')[0])
    .send({})
    .expect(204);
  assert.match(logout.headers['set-cookie'][0], /Expires=Thu, 01 Jan 1970/);
  await http
    .get('/api/kinopoisk/titles/301/autofill')
    .auth(again.body.access_token, { type: 'bearer' })
    .expect(401);
});
