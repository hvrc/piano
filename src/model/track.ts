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
  createdAt: number;
  updatedAt: number;
}

export const MIN_BPM = 20;
export const MAX_BPM = 400;
export const MAX_NOTES = 10_000; // keeps a Firestore document well under its 1 MiB limit
export const MAX_BEAT = 100_000;
export const TRACK_ID = /^[A-Za-z0-9-]{8,64}$/;
export const LIBRARY_KEY = /^[A-Za-z0-9_-]{22,64}$/;
