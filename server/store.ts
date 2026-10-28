// Track storage, partitioned by library (the SHA-256 of a client's library key).
// - FileStore: a JSON file, for local development.
// - FirestoreStore: production, Firestore Native database `piano`. Notes are stored as one flat
//   number array [pitch, start, duration, velocity, ...] so large tracks stay compact.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { NoteData, Track } from './validate.ts';

export interface TrackStore {
  list(library: string): Promise<Track[]>;
  count(library: string): Promise<number>;
  put(library: string, track: Track): Promise<void>;
  remove(library: string, id: string): Promise<void>;
}

interface StoredTrack extends Omit<Track, 'notes'> {
  n: number[];
}

function pack(t: Track): StoredTrack {
  const { notes, ...rest } = t;
  return { ...rest, n: notes.flatMap((x) => [x.pitch, x.start, x.duration, x.velocity]) };
}

function unpack(s: StoredTrack): Track {
  const notes: NoteData[] = [];
  for (let i = 0; i + 3 < s.n.length; i += 4) {
    notes.push({ pitch: s.n[i], start: s.n[i + 1], duration: s.n[i + 2], velocity: s.n[i + 3] });
  }
  return { id: s.id, name: s.name, bpm: s.bpm, notes, createdAt: s.createdAt, updatedAt: s.updatedAt };
}

const newestFirst = (a: Track, b: Track) => b.updatedAt - a.updatedAt;

// ------------------------------------------------------------------ file

export class FileStore implements TrackStore {
  private path: string;
  private data: Record<string, Record<string, StoredTrack>> | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(path: string) {
    this.path = path;
  }

  private async load() {
    if (!this.data) {
      try {
        this.data = JSON.parse(await readFile(this.path, 'utf8'));
      } catch {
        this.data = {};
      }
    }
    return this.data!;
  }

  private persist(): Promise<void> {
    // Serialise writes and replace the file atomically.
    this.writing = this.writing.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      await writeFile(tmp, JSON.stringify(this.data));
      await rename(tmp, this.path);
    });
    return this.writing;
  }

  async list(library: string) {
    const lib = (await this.load())[library] ?? {};
    return Object.values(lib).map(unpack).sort(newestFirst);
  }

  async count(library: string) {
    return Object.keys((await this.load())[library] ?? {}).length;
  }

  async put(library: string, track: Track) {
    const data = await this.load();
    (data[library] ??= {})[track.id] = pack(track);
    await this.persist();
  }

  async remove(library: string, id: string) {
    const data = await this.load();
    if (data[library]) delete data[library][id];
    await this.persist();
  }
}

// ------------------------------------------------------------------ firestore

export async function createFirestoreStore(databaseId: string): Promise<TrackStore> {
  const { Firestore } = await import('@google-cloud/firestore');
  const db = new Firestore({ databaseId, ignoreUndefinedProperties: true });
  const tracks = (library: string) => db.collection('libraries').doc(library).collection('tracks');

  return {
    async list(library) {
      const snap = await tracks(library).get();
      return snap.docs.map((d) => unpack(d.data() as StoredTrack)).sort(newestFirst);
    },
    async count(library) {
      const agg = await tracks(library).count().get();
      return agg.data().count;
    },
    async put(library, track) {
      await tracks(library).doc(track.id).set(pack(track));
    },
    async remove(library, id) {
      await tracks(library).doc(id).delete();
    },
  };
}
