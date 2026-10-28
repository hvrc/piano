// Validation for tracks arriving over the API. Anything malformed is rejected outright.
// Limits and types are shared with the client (src/model), so both sides agree.
import { MAX_VELOCITY, MIN_VELOCITY } from '../src/model/note.ts';
import type { NoteData } from '../src/model/note.ts';
import { MAX_BEAT, MAX_BPM, MAX_FOLDER_NAME, MAX_NOTES, MIN_BPM, type LoopSettings, type TrackRecord } from '../src/model/track.ts';
import { isValidPitch } from '../src/music/pitch.ts';
import { NOTE_COLOR } from '../src/model/colors.ts';

export type Track = TrackRecord;
export { TRACK_ID } from '../src/model/track.ts';

export class ValidationError extends Error {}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isBeat = (v: unknown): v is number => isNum(v) && v >= 0 && v <= MAX_BEAT;

/** Parse a track body for `id` (already checked by the router). */
export function parseTrack(id: string, body: unknown): Track {
  if (!body || typeof body !== 'object') throw new ValidationError('Expected a JSON object.');
  const b = body as Record<string, unknown>;

  const name = typeof b.name === 'string' ? b.name.trim().slice(0, 120) : '';
  if (!name) throw new ValidationError('A track needs a name.');
  if (!isNum(b.bpm) || b.bpm < MIN_BPM || b.bpm > MAX_BPM) throw new ValidationError(`bpm must be ${MIN_BPM}–${MAX_BPM}.`);
  if (!Array.isArray(b.notes)) throw new ValidationError('notes must be an array.');
  if (b.notes.length > MAX_NOTES) throw new ValidationError(`A track can hold at most ${MAX_NOTES} notes.`);

  const notes = b.notes.map((n: unknown, i: number): NoteData => {
    const o = (n ?? {}) as Record<string, unknown>;
    const ok =
      Number.isInteger(o.pitch) && isValidPitch(o.pitch as number) &&
      isBeat(o.start) &&
      isBeat(o.duration) && o.duration > 0 &&
      Number.isInteger(o.velocity) && (o.velocity as number) >= MIN_VELOCITY && (o.velocity as number) <= MAX_VELOCITY;
    if (!ok) throw new ValidationError(`Note ${i} is invalid.`);
    if (o.color !== undefined && (typeof o.color !== 'string' || !NOTE_COLOR.test(o.color))) {
      throw new ValidationError(`Note ${i} has an invalid colour.`);
    }
    const note: NoteData = { pitch: o.pitch as number, start: o.start as number, duration: o.duration as number, velocity: o.velocity as number };
    if (o.color) note.color = (o.color as string).toLowerCase();
    return note;
  });

  let loop: LoopSettings | undefined;
  if (b.loop !== undefined) {
    const l = (b.loop ?? {}) as Record<string, unknown>;
    if (typeof l.enabled !== 'boolean' || !isBeat(l.start) || !isBeat(l.end) || l.end <= l.start) {
      throw new ValidationError('loop is invalid.');
    }
    loop = { enabled: l.enabled, start: l.start, end: l.end };
  }

  if (b.folder !== undefined && typeof b.folder !== 'string') throw new ValidationError('folder must be a string.');
  const folder = typeof b.folder === 'string' ? b.folder.trim().slice(0, MAX_FOLDER_NAME) : '';

  const now = Date.now();
  const createdAt = isNum(b.createdAt) && b.createdAt <= now + 60_000 ? b.createdAt : now;
  return { id, name, bpm: b.bpm, notes, ...(loop ? { loop } : {}), ...(folder ? { folder } : {}), createdAt, updatedAt: now };
}
