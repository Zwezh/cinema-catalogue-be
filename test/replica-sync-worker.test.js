const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, existsSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { createServer } = require('node:http');
const { ReplicaSyncWorker } = require('../src/database/replica-sync-worker');

function fixture(t, body, timeout = 2000) {
  const dir = mkdtempSync(join(tmpdir(), 'replica-worker-'));
  const modulePath = join(dir, 'client.cjs');
  writeFileSync(modulePath, body);
  const worker = new ReplicaSyncWorker(
    { url: 'file:fixture' },
    modulePath,
    timeout,
  );
  t.after(async () => {
    await worker.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { worker, dir };
}

test('blocking native synchronization does not stall foreground HTTP requests', async (t) => {
  const { worker, dir } = fixture(
    t,
    `
    const fs = require('node:fs');
    exports.createClient = () => ({ sync() {
      fs.writeFileSync(__dirname + '/started', '');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
    }, close() {} });
  `,
  );
  const server = createServer((_req, res) => res.end('responsive'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const sync = worker.sync();
  const deadline = Date.now() + 1500;
  while (!existsSync(join(dir, 'started')) && Date.now() < deadline)
    await delay(5);
  assert.ok(existsSync(join(dir, 'started')));
  const response = fetch(`http://127.0.0.1:${server.address().port}`).then(
    async (res) => {
      assert.equal(await res.text(), 'responsive');
      return 'http';
    },
  );
  assert.equal(await Promise.race([response, sync.then(() => 'sync')]), 'http');
  await sync;
});

test('a stalled sync times out, kills its worker and can recover on the next sync', async (t) => {
  const { worker, dir } = fixture(
    t,
    `
    exports.createClient = () => ({ sync() { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10000); }, close() {} });
  `,
    1500,
  );
  await assert.rejects(worker.sync(), /failed or timed out/);
  writeFileSync(
    join(dir, 'client.cjs'),
    `exports.createClient = () => ({ sync() {}, close() {} });`,
  );
  await worker.sync();
});

test('provider errors are sanitized and closing cancels outstanding synchronization', async (t) => {
  const { worker } = fixture(
    t,
    `exports.createClient = () => { throw Error('private provider credential'); };`,
  );
  await assert.rejects(worker.sync(), (error) => {
    assert.equal(error.message, 'Replica synchronization failed or timed out');
    return true;
  });
  const pending = worker.sync();
  const rejected = assert.rejects(pending, /failed or timed out/);
  await worker.close();
  await rejected;
  await assert.rejects(worker.sync(), /closed/);
});
