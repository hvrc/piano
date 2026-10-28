// Tracks API tests. By default spawns the server with a throwaway file store.
// Set BASE=http://host:port to run against an already-running server (emulator or live).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const PORT = 5291;
let BASE = process.env.BASE ?? '';
let server: ChildProcess | undefined;
let dir = '';

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}

/** Tracks are public and shared, so tests only look at the ones they created. */
async function find(id: string) {
  return (await call('GET', '/api/tracks')).body.tracks.find((t: { id: string }) => t.id === id);
}

const track = (over: Record<string, unknown> = {}) => ({
  name: 'Test melody',
  bpm: 110,
  notes: [
    { pitch: 60, start: 0, duration: 0.5, velocity: 100 },
    { pitch: 67, start: 1 / 3, duration: 2 / 3, velocity: 64 },
  ],
  ...over,
});

before(async () => {
  if (BASE) return;
  dir = mkdtempSync(join(tmpdir(), 'piano-api-'));
  BASE = `http://localhost:${PORT}`;
  server = spawn(process.execPath, ['server/index.ts'], {
    env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT), DATA_FILE: join(dir, 'tracks.json'), WRITES_PER_10_MIN: '1000' },
    stdio: 'inherit',
  });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${BASE}/_healthz`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
});

after(() => {
  server?.kill();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test('health check', async () => {
  assert.equal((await call('GET', '/_healthz')).status, 200);
});

test('save, list, update and delete a track', async () => {
  const id = randomUUID();
  assert.equal(await find(id), undefined);

  const saved = await call('PUT', `/api/tracks/${id}`, track());
  assert.equal(saved.status, 200);
  assert.equal(saved.body.track.name, 'Test melody');

  const listed = await find(id);
  assert.deepEqual(listed.notes, track().notes); // exact, including thirds of a beat
  const createdAt = listed.createdAt;

  await new Promise((r) => setTimeout(r, 5));
  const updated = await call('PUT', `/api/tracks/${id}`, track({ name: 'Renamed', bpm: 90, createdAt: 1 }));
  assert.equal(updated.status, 200);
  const after = await find(id);
  assert.equal(after.name, 'Renamed');
  assert.equal(after.bpm, 90);
  assert.equal(after.createdAt, createdAt, 'createdAt is kept from the first save');
  assert.ok(after.updatedAt > createdAt);

  assert.equal((await call('DELETE', `/api/tracks/${id}`)).status, 200);
  assert.equal(await find(id), undefined);
});

test('stores the loop with the track', async () => {
  const id = randomUUID();
  const loop = { enabled: true, start: 4, end: 12 };
  assert.equal((await call('PUT', `/api/tracks/${id}`, track({ loop }))).status, 200);
  assert.deepEqual((await find(id)).loop, loop);
  for (const bad of [{ enabled: 'yes', start: 0, end: 4 }, { enabled: true, start: 4, end: 4 }, { enabled: true, start: -1, end: 4 }]) {
    assert.equal((await call('PUT', `/api/tracks/${id}`, track({ loop: bad }))).status, 400);
  }
  await call('DELETE', `/api/tracks/${id}`);
});

test('keeps note colours, and rejects malformed ones', async () => {
  const id = randomUUID();
  const notes = [
    { pitch: 60, start: 0, duration: 1, velocity: 100, color: '#6eaecd' },
    { pitch: 62, start: 1, duration: 1, velocity: 100 },
  ];
  assert.equal((await call('PUT', `/api/tracks/${id}`, track({ notes }))).status, 200);
  assert.deepEqual((await find(id)).notes, notes);
  const bad = [{ ...notes[0], color: 'blue' }];
  assert.equal((await call('PUT', `/api/tracks/${id}`, track({ notes: bad }))).status, 400);
  await call('DELETE', `/api/tracks/${id}`);
});

test('rejects malformed tracks', async () => {
  const id = randomUUID();
  const bad = [
    track({ name: '' }),
    track({ bpm: 5 }),
    track({ notes: 'nope' }),
    track({ notes: [{ pitch: 128, start: 0, duration: 1, velocity: 100 }] }),
    track({ notes: [{ pitch: 60, start: -1, duration: 1, velocity: 100 }] }),
    track({ notes: [{ pitch: 60, start: 0, duration: 0, velocity: 100 }] }),
    track({ notes: Array.from({ length: 10_001 }, () => ({ pitch: 60, start: 0, duration: 1, velocity: 100 })) }),
  ];
  for (const b of bad) assert.equal((await call('PUT', `/api/tracks/${id}`, b)).status, 400, JSON.stringify(b).slice(0, 80));
  assert.equal((await call('PUT', '/api/tracks/bad id!', track())).status, 400);
  assert.equal(await find(id), undefined);
});
