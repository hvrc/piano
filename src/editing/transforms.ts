// Pure note transforms (no app state), so they can be unit-tested directly in Node.

interface TimedNote {
  start: number; // beats
  duration: number; // beats
  velocity: number;
}

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
    const velocity = Math.max(1, Math.min(127, Math.round(n.velocity + jitter(random) * opts.velocity)));
    return { ...n, start, velocity };
  });
}

/**
 * Live's Legato: every note is stretched (or shortened) to end exactly where the next note
 * begins. Notes starting together (chords) all extend to the next start. The last note keeps
 * its length.
 */
export function legato<T extends TimedNote>(notes: T[]): T[] {
  const starts = [...new Set(notes.map((n) => n.start))].sort((a, b) => a - b);
  return notes.map((n) => {
    const next = starts.find((s) => s > n.start + 1e-9);
    return next === undefined ? n : { ...n, duration: next - n.start };
  });
}
