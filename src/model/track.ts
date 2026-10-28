// The saved-track format and the limits both the client and the server enforce.
// Plain JS + types only, so the server can import it with Node type stripping.
import type { NoteData } from './note.ts';

/** Live's loop brace: when enabled, playback that reaches `end` jumps back to `start` (beats). */
export interface LoopSettings {
  enabled: boolean;
  start: number;
  end: number;
}

export interface TrackRecord {
  id: string;
  name: string;
  bpm: number;
  notes: NoteData[];
  loop?: LoopSettings;
  /** The sidebar folder it's filed in; absent means unfiled. */
  folder?: string;
  createdAt: number;
  updatedAt: number;
}

export const MIN_BPM = 20;
export const MAX_BPM = 400;
// Stored compactly (4 numbers per note = 32 B, +8 B with a colour): 20k fully coloured notes ≈ 800 KB,
// still under Firestore's 1 MiB document limit.
export const MAX_NOTES = 20_000;
export const MAX_FOLDER_NAME = 60;
export const MAX_BEAT = 100_000;
export const TRACK_ID = /^[A-Za-z0-9-]{8,64}$/;
