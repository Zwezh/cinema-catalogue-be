const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, statSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createClient } = require('@libsql/client');
const { CatalogReadReplica } = require('../src/database/catalog-read-replica');
const { writeCatalogTransaction } = require('../src/database/transaction');
const { validateEnvironment } = require('../src/config/environment');

function replicaFixture(t, sync) {
  const dir = mkdtempSync(join(tmpdir(), 'catalog-replica-test-'));
  const path = join(dir, 'replica.sqlite');
  writeFileSync(path, '');
  const calls = [];
  const synchronizer = { sync, close: () => calls.push('sync-close') };
  const reader = { close: () => calls.push('reader-close') };
  const replica = new CatalogReadReplica(
    { path, syncUrl: 'libsql://fixture.invalid', syncIntervalMs: 30000 },
    (options) => {
      calls.push(options.syncUrl ? 'synchronizer' : 'reader');
      return options.syncUrl ? synchronizer : reader;
    },
  );
  t.after(async () => {
    await replica.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { replica, reader, calls, path };
}

test('replica starts only after synchronization and protects the database file', async (t) => {
  const { replica, reader, calls, path } = replicaFixture(t, async () => {});
  assert.equal(replica.client, undefined);
  await replica.start();
  assert.equal(replica.client, reader);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.deepEqual(calls, ['synchronizer', 'reader']);
  await replica.close();
  assert.equal(replica.client, undefined);
  assert.ok(calls.includes('reader-close'));
  assert.ok(calls.includes('sync-close'));
});

test('replica failures disable local reads and a later sync restores them', async (t) => {
  let fail = false;
  const { replica, reader } = replicaFixture(t, async () => {
    if (fail) throw Error('fixture sync failure');
  });
  await replica.start();
  fail = true;
  await replica.refresh();
  assert.equal(replica.client, undefined);
  fail = false;
  await replica.refresh();
  assert.equal(replica.client, reader);
});

test('a post-write refresh is queued after an already-running background synchronization', async (t) => {
  let release;
  let syncs = 0;
  const { replica } = replicaFixture(t, () => {
    syncs++;
    if (syncs === 1)
      return new Promise((resolve) => {
        release = resolve;
      });
    return Promise.resolve();
  });
  const background = replica.refresh();
  await Promise.resolve();
  const afterWrite = replica.refresh();
  assert.equal(syncs, 1);
  release();
  await Promise.all([background, afterWrite]);
  assert.equal(syncs, 2);
  assert.ok(replica.client);
});

test('catalogue writes commit to the primary before refresh and rollbacks do not refresh', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'catalog-write-test-'));
  const url = `file:${join(dir, 'primary.sqlite')}`;
  const primary = createClient({ url });
  const observer = createClient({ url });
  t.after(() => {
    primary.close();
    observer.close();
    rmSync(dir, { recursive: true, force: true });
  });
  await primary.execute('CREATE TABLE fixture(id INTEGER PRIMARY KEY)');
  let refreshes = 0;
  const database = {
    client: primary,
    refreshReadReplica: async () => {
      refreshes++;
      assert.equal(
        (await observer.execute('SELECT COUNT(*) AS n FROM fixture')).rows[0].n,
        1,
      );
    },
  };
  assert.equal(
    await writeCatalogTransaction(database, async (tx) => {
      await tx.execute('INSERT INTO fixture VALUES(1)');
      return 'committed';
    }),
    'committed',
  );
  await assert.rejects(
    writeCatalogTransaction(database, async (tx) => {
      await tx.execute('INSERT INTO fixture VALUES(2)');
      throw Error('rollback');
    }),
    /rollback/,
  );
  assert.equal(refreshes, 1);
  assert.equal(
    (await observer.execute('SELECT COUNT(*) AS n FROM fixture')).rows[0].n,
    1,
  );
});

test('replica configuration is optional and validates path, sync interval and primary type', () => {
  const base = {
    JWT_KEY: 'x'.repeat(32),
    TURSO_DATABASE_URL: 'libsql://fixture.invalid',
  };
  assert.equal(validateEnvironment(base).TURSO_REPLICA_SYNC_MS, 30000);
  assert.equal(
    validateEnvironment({ ...base, TURSO_REPLICA_PATH: '' }).TURSO_REPLICA_PATH,
    undefined,
  );
  assert.equal(
    validateEnvironment({
      ...base,
      TURSO_REPLICA_PATH: '.tmp/replica/db.sqlite',
      TURSO_REPLICA_SYNC_MS: '1000',
    }).TURSO_REPLICA_SYNC_MS,
    1000,
  );
  for (const path of [' ', 1, 'name\0.sqlite', ' path '])
    assert.throws(
      () => validateEnvironment({ ...base, TURSO_REPLICA_PATH: path }),
      /TURSO_REPLICA_PATH/,
    );
  assert.throws(
    () => validateEnvironment({ ...base, TURSO_REPLICA_SYNC_MS: '0' }),
    /TURSO_REPLICA_SYNC_MS/,
  );
  assert.throws(
    () =>
      validateEnvironment({
        ...base,
        TURSO_DATABASE_URL: 'file:local.sqlite',
        TURSO_REPLICA_PATH: 'replica.sqlite',
      }),
    /remote primary/,
  );
});

test('public catalogue reads use the replica but writes and authentication use the primary', async (t) => {
  const { initializeDatabase } = require('../src/database/schema');
  const { MoviesService } = require('../src/modules/movies/movies.service');
  const {
    MoviesRepository,
  } = require('../src/modules/movies/movies.repository');
  const { AuthRepository } = require('../src/modules/auth/auth.repository');
  const dir = mkdtempSync(join(tmpdir(), 'catalog-routing-test-'));
  const primary = createClient({ url: `file:${join(dir, 'primary.sqlite')}` });
  const reader = createClient({ url: `file:${join(dir, 'reader.sqlite')}` });
  t.after(() => {
    primary.close();
    reader.close();
    rmSync(dir, { recursive: true, force: true });
  });
  await initializeDatabase(primary);
  await initializeDatabase(reader);
  const input = {
    addedDate: '2026-10-02',
    ageRating: null,
    backdropUrl: '',
    compactPosterUrl: '',
    countries: [],
    description: '',
    director: [],
    enName: '',
    extension: 'MKV',
    genres: [],
    isSeries: false,
    kpId: 1,
    posterUrl: '',
    name: 'Replica title',
    movieLength: 90,
    actors: [],
    quality: '1080p',
    rating: 7,
    year: 2020,
    sequelsAndPrequels: [],
    similarMovies: [],
  };
  const stored = await new MoviesService(
    new MoviesRepository({ client: reader }),
  ).create(input);
  let refreshes = 0;
  const database = {
    client: primary,
    readClient: reader,
    refreshReadReplica: async () => {
      refreshes++;
      assert.equal(
        (await primary.execute('SELECT COUNT(*) AS n FROM titles')).rows[0].n,
        1,
      );
    },
  };
  const service = new MoviesService(new MoviesRepository(database));
  assert.equal((await service.findAll({})).list[0].id, stored.id);
  assert.equal((await service.findOne(stored.id)).name, 'Replica title');
  await service.create({ ...input, name: 'Primary title' });
  assert.equal(refreshes, 1);
  assert.equal(
    (await primary.execute('SELECT name FROM titles')).rows[0].name,
    'Primary title',
  );
  await primary.execute(
    "INSERT INTO auth_credentials VALUES('primary-admin','primary-hash')",
  );
  await reader.execute(
    "INSERT INTO auth_credentials VALUES('stale-admin','stale-hash')",
  );
  assert.equal(
    (await new AuthRepository(database).findAdministrator()).id,
    'primary-admin',
  );
});
