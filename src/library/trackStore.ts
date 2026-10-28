// Saved tracks live on the server (Firestore in production) in one public list:
// everyone who visits sees, and can edit, the same tracks.
import type { TrackRecord } from '../model/track';

export type { TrackRecord };

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json' },
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
