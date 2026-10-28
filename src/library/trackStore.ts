// Saved tracks live on the server (Firestore in production), grouped into a "library".
// Each browser holds a random library key; the server only ever stores its hash.
// Opening a library link (/#library=KEY) on another device shares the same library.
import { LIBRARY_KEY, type TrackRecord } from '../model/track';
import { storageGet, storageSet } from '../util/storage';

export type { TrackRecord };

const KEY_STORAGE = 'piano:library';

let memoryKey: string | null = null;

function newKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function libraryKey(): string {
  const stored = storageGet(KEY_STORAGE);
  if (stored && LIBRARY_KEY.test(stored)) return stored;
  // No storage (private mode) falls back to a key that lasts for this page.
  memoryKey ??= newKey();
  storageSet(KEY_STORAGE, memoryKey);
  return memoryKey;
}

export function setLibraryKey(key: string): void {
  memoryKey = key;
  storageSet(KEY_STORAGE, key);
}

export function isLibraryKey(value: string): boolean {
  return LIBRARY_KEY.test(value);
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
