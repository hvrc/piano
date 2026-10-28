// Saved tracks live on the server (Firestore in production), grouped into a "library".
// Each browser holds a random library key; the server only ever stores its hash.
// Opening a library link (/#library=KEY) on another device shares the same library.
import type { MidiNote } from '../midi/smf';
import type { LoopSettings } from '../state/store';

export interface TrackRecord {
  id: string;
  name: string;
  bpm: number;
  notes: MidiNote[];
  loop?: LoopSettings;
  createdAt: number;
  updatedAt: number;
}

const KEY_STORAGE = 'piano:library';
const KEY_PATTERN = /^[A-Za-z0-9_-]{22,64}$/;

let memoryKey: string | null = null;

function newKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function libraryKey(): string {
  try {
    let key = localStorage.getItem(KEY_STORAGE);
    if (!key || !KEY_PATTERN.test(key)) {
      key = newKey();
      localStorage.setItem(KEY_STORAGE, key);
    }
    return key;
  } catch {
    return (memoryKey ??= newKey());
  }
}

export function setLibraryKey(key: string): void {
  memoryKey = key;
  try {
    localStorage.setItem(KEY_STORAGE, key);
  } catch {
    // fall back to the in-memory key
  }
}

export function isLibraryKey(value: string): boolean {
  return KEY_PATTERN.test(value);
}

export function libraryLink(): string {
  return `${location.origin}/#library=${libraryKey()}`;
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-Library-Key': libraryKey() },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `The server answered ${res.status}.`);
  return body as T;
}

export async function listTracks(): Promise<TrackRecord[]> {
  return (await api<{ tracks: TrackRecord[] }>('/tracks')).tracks;
}

export async function putTrack(track: TrackRecord): Promise<TrackRecord> {
  return (await api<{ track: TrackRecord }>(`/tracks/${encodeURIComponent(track.id)}`, {
    method: 'PUT',
    body: JSON.stringify(track),
  })).track;
}

export async function deleteTrack(id: string): Promise<void> {
  await api(`/tracks/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
