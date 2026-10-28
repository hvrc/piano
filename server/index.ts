// piano server: serves the built app and a small tracks API.
//   GET    /api/tracks        list the caller's library
//   PUT    /api/tracks/:id    create or replace a track
//   DELETE /api/tracks/:id    delete a track
//   GET    /_healthz          health check (Cloud Run reserves /healthz)
// Saved tracks are public: everyone who visits sees (and can edit) the same list.
// In development (`pnpm dev`) the same server hosts Vite in middleware mode.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { createFirestoreStore, FileStore, type TrackStore } from './store.ts';
import { parseTrack, TRACK_ID, ValidationError } from './validate.ts';

const PROD = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT ?? 5190);
const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const MAX_BODY = 4_000_000; // a 20k-note track is ~1.6 MB of JSON
const MAX_TRACKS = Number(process.env.MAX_TRACKS ?? 5000);
const WRITES_PER_10_MIN = Number(process.env.WRITES_PER_10_MIN ?? 300);

const store: TrackStore =
  process.env.STORE === 'firestore'
    ? await createFirestoreStore(process.env.FIRESTORE_DATABASE ?? 'piano')
    : new FileStore(process.env.DATA_FILE ?? join(ROOT, 'data', 'tracks.json'));

// ------------------------------------------------------------------ helpers

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(json);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'Track is too large.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Body must be JSON.');
  }
}


// Per-IP write limiter (per instance; enough to stop a runaway client).
const writes = new Map<string, number[]>();
function limitWrites(req: IncomingMessage) {
  const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '').split(',')[0].trim();
  const now = Date.now();
  const recent = (writes.get(ip) ?? []).filter((t) => now - t < 600_000);
  if (recent.length >= WRITES_PER_10_MIN) throw new HttpError(429, 'Too many saves. Try again in a few minutes.');
  recent.push(now);
  writes.set(ip, recent);
  if (writes.size > 10_000) {
    for (const [k, times] of writes) if (now - times[times.length - 1] >= 600_000) writes.delete(k);
  }
}

// ------------------------------------------------------------------ API

async function api(req: IncomingMessage, res: ServerResponse, path: string) {
  if (path === '/api/tracks' && req.method === 'GET') {
    return send(res, 200, { tracks: await store.list() });
  }
  const m = path.match(/^\/api\/tracks\/([^/]+)$/);
  if (!m) throw new HttpError(404, 'Not found.');
  const id = decodeURIComponent(m[1]);
  if (!TRACK_ID.test(id)) throw new HttpError(400, 'Invalid track id.');

  if (req.method === 'PUT') {
    limitWrites(req);
    const track = parseTrack(id, await readJson(req));
    const existing = await store.get(id);
    if (!existing && (await store.count()) >= MAX_TRACKS) {
      throw new HttpError(409, `The track list is full (${MAX_TRACKS} tracks).`);
    }
    if (existing) track.createdAt = existing.createdAt;
    await store.put(track);
    return send(res, 200, { track });
  }
  if (req.method === 'DELETE') {
    limitWrites(req);
    await store.remove(id);
    return send(res, 200, { ok: true });
  }
  throw new HttpError(405, 'Method not allowed.');
}

// ------------------------------------------------------------------ static (production)

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

async function serveStatic(req: IncomingMessage, res: ServerResponse, path: string) {
  let file = normalize(join(DIST, decodeURIComponent(path)));
  if (!file.startsWith(DIST)) throw new HttpError(404, 'Not found.');
  let info = await stat(file).catch(() => null);
  if (!info || info.isDirectory()) {
    file = join(DIST, 'index.html');
    info = await stat(file);
  }
  const ext = extname(file);
  const cache = file.includes(`${DIST}/assets/`)
    ? 'public, max-age=31536000, immutable' // content-hashed by Vite
    : ext === '.mp3'
      ? 'public, max-age=2592000'
      : 'no-cache';
  res.writeHead(200, {
    'Content-Type': TYPES[ext] ?? 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': cache,
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}

// ------------------------------------------------------------------ server

const vite = PROD
  ? null
  : await (await import('vite')).createServer({ root: ROOT, server: { middlewareMode: true }, appType: 'spa' });

createServer(async (req, res) => {
  const path = new URL(req.url ?? '/', 'http://x').pathname;
  try {
    if (path === '/_healthz') return send(res, 200, { ok: true });
    if (path.startsWith('/api/')) return await api(req, res, path);
    if (vite) return vite.middlewares(req, res);
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');
    return await serveStatic(req, res, path);
  } catch (err) {
    if (err instanceof HttpError) return send(res, err.status, { error: err.message });
    if (err instanceof ValidationError) return send(res, 400, { error: err.message });
    console.error(err);
    if (!res.headersSent) send(res, 500, { error: 'Something went wrong on the server.' });
  }
}).listen(PORT, () => {
  console.log(`piano on http://localhost:${PORT} (${PROD ? 'production' : 'dev'}, store: ${process.env.STORE ?? 'file'})`);
});
