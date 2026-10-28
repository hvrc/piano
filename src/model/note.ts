// A note lives in musical time: start and duration are in beats (quarter notes).
export interface Note {
  id: number;
  pitch: number; // MIDI 0–127
  start: number; // beats
  duration: number; // beats
  velocity: number; // 1–127
}

export const DEFAULT_VELOCITY = 100;

export function noteEnd(n: Note): number {
  return n.start + n.duration;
}
