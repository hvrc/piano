// Pure note transforms (no app state), so they can be unit-tested directly in Node.
import { clampVelocity, type NoteData } from '../model/note.ts';
import { snapRound } from '../timeline/grid.ts';

const EPS = 1e-9;

type TimedNote = Pick<NoteData, 'start' | 'duration' | 'velocity'>;

export interface HumanizeOptions {
  timingMs: number; // maximum nudge either way
  velocity: number; // maximum velocity change either way
}

/** Random value in [-1, 1], weighted towards 0 (sum of two uniforms), so most nudges are small. */
function jitter(random: () => number): number {
  return random() + random() - 1;
}

/**
 * Nudge each note slightly earlier or later at random (keeping its length), and optionally
 * vary its velocity. Timing is in milliseconds so the feel is the same at any tempo.
 */
export function humanize<T extends TimedNote>(
  notes: T[],
  bpm: number,
  opts: HumanizeOptions,
  random: () => number = Math.random,
): T[] {
  const maxBeats = (opts.timingMs / 1000) * (bpm / 60);
  return notes.map((n) => {
    const start = Math.max(0, n.start + jitter(random) * maxBeats);
    const velocity = clampVelocity(n.velocity + jitter(random) * opts.velocity);
    return { ...n, start, velocity };
  });
}

export interface QuantizeOptions {
  amount: number; // 0..1: how far each note moves towards the grid (1 = all the way)
  ends: boolean; // also quantize where notes end (otherwise lengths are kept)
}

/**
 * Live's Quantize: pull note starts (and optionally ends) towards the nearest grid line by
 * `amount`. A note whose quantized end would land on its start keeps one grid step of length.
 */
export function quantize<T extends TimedNote>(notes: T[], step: number, opts: QuantizeOptions): T[] {
  const pull = (beat: number) => beat + (snapRound(beat, step) - beat) * opts.amount;
  return notes.map((n) => {
    const start = Math.max(0, pull(n.start));
    if (!opts.ends) return { ...n, start };
    const end = pull(n.start + n.duration);
    return { ...n, start, duration: end - start > EPS ? end - start : step };
  });
}

/**
 * Live's Rev: play the notes backwards. Each note is mirrored within the span the notes cover
 * (first start to last end), so the last note to end becomes the first to start. Pitches,
 * lengths and velocities stay the same.
 */
export function reverse<T extends TimedNote>(notes: T[]): T[] {
  if (!notes.length) return notes;
  const from = Math.min(...notes.map((n) => n.start));
  const to = Math.max(...notes.map((n) => n.start + n.duration));
  return notes.map((n) => ({ ...n, start: from + to - (n.start + n.duration) }));
}

/**
 * Live's Legato: every note is stretched (or shortened) to end exactly where the next note
 * begins. Notes starting together (chords) all extend to the next start. The last note keeps
 * its length.
 */
export function legato<T extends TimedNote>(notes: T[]): T[] {
  const starts = [...new Set(notes.map((n) => n.start))].sort((a, b) => a - b);
  return notes.map((n) => {
    const next = starts.find((s) => s > n.start + EPS);
    return next === undefined ? n : { ...n, duration: next - n.start };
  });
}
