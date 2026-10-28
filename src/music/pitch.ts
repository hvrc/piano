// MIDI pitch helpers. Naming follows Ableton Live: MIDI 60 = C3, range C-2 (0) to G8 (127).

export const MIN_PITCH = 0;
export const MAX_PITCH = 127;
export const PITCH_COUNT = 128;

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const BLACK = [false, true, false, true, false, false, true, false, true, false, true, false];

export function isBlackKey(pitch: number): boolean {
  return BLACK[pitch % 12];
}

export function pitchName(pitch: number): string {
  return NAMES[pitch % 12] + (Math.floor(pitch / 12) - 2);
}

export function clampPitch(pitch: number): number {
  return Math.max(MIN_PITCH, Math.min(MAX_PITCH, pitch));
}

export function isValidPitch(pitch: number): boolean {
  return pitch >= MIN_PITCH && pitch <= MAX_PITCH;
}
