// Notes live in musical time: start and duration are in beats (quarter notes).
// Plain JS + types only, so Node can import it with type stripping (server, tests).

/** A note's musical content: what is saved, exported to MIDI and sent to the server. */
export interface NoteData {
  pitch: number; // MIDI 0–127
  start: number; // beats
  duration: number; // beats
  velocity: number; // 1–127
  color?: string; // '#rrggbb'; absent = the default note colour
}

/** A note in the editor: content plus a stable identity for selection and undo. */
export interface Note extends NoteData {
  id: number;
}

export const MIN_VELOCITY = 1;
export const MAX_VELOCITY = 127;
export const DEFAULT_VELOCITY = 100;

export function clampVelocity(v: number): number {
  return Math.max(MIN_VELOCITY, Math.min(MAX_VELOCITY, Math.round(v)));
}

export function noteEnd(n: { start: number; duration: number }): number {
  return n.start + n.duration;
}

/** End of the last note (0 when there are none). */
export function notesEnd(notes: readonly { start: number; duration: number }[]): number {
  let end = 0;
  for (const n of notes) end = Math.max(end, noteEnd(n));
  return end;
}

/** Earliest start and pitch range of a group of notes (the limits for moving it). */
export function noteBounds(notes: readonly NoteData[]): { start: number; lo: number; hi: number } {
  let start = Infinity;
  let lo = Infinity;
  let hi = -Infinity;
  for (const n of notes) {
    start = Math.min(start, n.start);
    lo = Math.min(lo, n.pitch);
    hi = Math.max(hi, n.pitch);
  }
  return { start, lo, hi };
}
