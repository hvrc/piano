// Tracks API tests. By default spawns the server with a throwaway file store.
// Set BASE=http://host:port to run against an already-running server (emulator or live).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';

const PORT = 5291;
let BASE = process.env.BASE ?? '';
let server: ChildProcess | undefined;
let dir = '';

const key = () => randomBytes(18).toString('base64url');
const libA = key();
const libB = key();

async function call(method: string, path: string, lib: string | null, body?: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (lib) headers['X-Library-Key'] = lib;
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
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
  assert.equal((await call('GET', '/_healthz', null)).status, 200);
});

test('requires a valid library key', async () => {
  assert.equal((await call('GET', '/api/tracks', null)).status, 401);
  assert.equal((await call('GET', '/api/tracks', 'short')).status, 401);
});

test('save, list, update and delete a track', async () => {
  const id = randomUUID();
  assert.deepEqual((await call('GET', '/api/tracks', libA)).body, { tracks: [] });

  const saved = await call('PUT', `/api/tracks/${id}`, libA, track());
  assert.equal(saved.status, 200);
  assert.equal(saved.body.track.name, 'Test melody');

  const listed = (await call('GET', '/api/tracks', libA)).body.tracks;
  assert.equal(listed.length, 1);
  assert.deepEqual(listed[0].notes, track().notes); // exact, including thirds of a beat
  const createdAt = listed[0].createdAt;

  await new Promise((r) => setTimeout(r, 5));
  const updated = await call('PUT', `/api/tracks/${id}`, libA, track({ name: 'Renamed', bpm: 90, createdAt: 1 }));
  assert.equal(updated.status, 200);
  const after = (await call('GET', '/api/tracks', libA)).body.tracks[0];
  assert.equal(after.name, 'Renamed');
  assert.equal(after.bpm, 90);
  assert.equal(after.createdAt, createdAt, 'createdAt is kept from the first save');
  assert.ok(after.updatedAt > createdAt);

  assert.equal((await call('DELETE', `/api/tracks/${id}`, libA)).status, 200);
  assert.deepEqual((await call('GET', '/api/tracks', libA)).body, { tracks: [] });
});

test('libraries are isolated from each other', async () => {
  const id = randomUUID();
  await call('PUT', `/api/tracks/${id}`, libA, track());
  assert.deepEqual((await call('GET', '/api/tracks', libB)).body, { tracks: [] });
  await call('DELETE', `/api/tracks/${id}`, libB); // must not touch libA's track
  assert.equal((await call('GET', '/api/tracks', libA)).body.tracks.length, 1);
  await call('DELETE', `/api/tracks/${id}`, libA);
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
  for (const b of bad) assert.equal((await call('PUT', `/api/tracks/${id}`, libA, b)).status, 400, JSON.stringify(b).slice(0, 80));
  assert.equal((await call('PUT', '/api/tracks/bad id!', libA, track())).status, 400);
  assert.equal((await call('GET', '/api/tracks', libA)).body.tracks.length, 0);
});
