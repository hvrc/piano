// Validation for tracks arriving over the API. Anything malformed is rejected outright.

export interface NoteData {
  pitch: number;
  start: number;
  duration: number;
  velocity: number;
}

export interface Loop {
  enabled: boolean;
  start: number;
  end: number;
}

export interface Track {
  id: string;
  name: string;
  bpm: number;
  notes: NoteData[];
  loop?: Loop;
  createdAt: number;
  updatedAt: number;
}

export const MAX_NOTES = 10_000; // keeps a Firestore document well under its 1 MiB limit
const MAX_BEAT = 100_000;

export class ValidationError extends Error {}

export const TRACK_ID = /^[A-Za-z0-9-]{8,64}$/;
export const LIBRARY_KEY = /^[A-Za-z0-9_-]{22,64}$/;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function parseTrack(id: string, body: unknown): Track {
  if (!TRACK_ID.test(id)) throw new ValidationError('Invalid track id.');
  if (!body || typeof body !== 'object') throw new ValidationError('Expected a JSON object.');
  const b = body as Record<string, unknown>;

  const name = typeof b.name === 'string' ? b.name.trim().slice(0, 120) : '';
  if (!name) throw new ValidationError('A track needs a name.');
  if (!isNum(b.bpm) || b.bpm < 20 || b.bpm > 400) throw new ValidationError('bpm must be 20–400.');
  if (!Array.isArray(b.notes)) throw new ValidationError('notes must be an array.');
  if (b.notes.length > MAX_NOTES) throw new ValidationError(`A track can hold at most ${MAX_NOTES} notes.`);

  const notes = b.notes.map((n: unknown, i: number): NoteData => {
    const o = (n ?? {}) as Record<string, unknown>;
    const ok =
      Number.isInteger(o.pitch) && (o.pitch as number) >= 0 && (o.pitch as number) <= 127 &&
      isNum(o.start) && o.start >= 0 && o.start <= MAX_BEAT &&
      isNum(o.duration) && o.duration > 0 && o.duration <= MAX_BEAT &&
      Number.isInteger(o.velocity) && (o.velocity as number) >= 1 && (o.velocity as number) <= 127;
    if (!ok) throw new ValidationError(`Note ${i} is invalid.`);
    return { pitch: o.pitch as number, start: o.start as number, duration: o.duration as number, velocity: o.velocity as number };
  });

  let loop: Loop | undefined;
  if (b.loop !== undefined) {
    const l = (b.loop ?? {}) as Record<string, unknown>;
    const ok =
      typeof l.enabled === 'boolean' &&
      isNum(l.start) && l.start >= 0 && l.start <= MAX_BEAT &&
      isNum(l.end) && l.end > l.start && l.end <= MAX_BEAT;
    if (!ok) throw new ValidationError('loop is invalid.');
    loop = { enabled: l.enabled as boolean, start: l.start as number, end: l.end as number };
  }

  const now = Date.now();
  const createdAt = isNum(b.createdAt) && b.createdAt <= now + 60_000 ? b.createdAt : now;
  return { id, name, bpm: b.bpm, notes, ...(loop ? { loop } : {}), createdAt, updatedAt: now };
}
