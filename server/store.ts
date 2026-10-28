// Track storage: one public list of tracks.
// - FileStore: a JSON file, for local development.
// - FirestoreStore: production, Firestore Native database `piano`, collection `tracks`. Notes are
//   stored as one flat number array [pitch, start, duration, velocity, ...] so large tracks stay compact.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { NoteData } from '../src/model/note.ts';
import type { Track } from './validate.ts';

export interface TrackStore {
  list(): Promise<Track[]>;
  get(id: string): Promise<Track | null>;
  count(): Promise<number>;
  put(track: Track): Promise<void>;
  remove(id: string): Promise<void>;
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
  return {
    id: s.id,
    name: s.name,
    bpm: s.bpm,
    notes,
    ...(s.loop ? { loop: s.loop } : {}),
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

const newestFirst = (a: Track, b: Track) => b.updatedAt - a.updatedAt;

// ------------------------------------------------------------------ file

type FileData = Record<string, StoredTrack>;

export class FileStore implements TrackStore {
  private path: string;
  private data: FileData | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(path: string) {
    this.path = path;
  }

  private async load(): Promise<FileData> {
    if (!this.data) {
      try {
        this.data = JSON.parse(await readFile(this.path, 'utf8')) as FileData;
      } catch {
        this.data = {};
      }
    }
    return this.data;
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

  async list() {
    return Object.values(await this.load()).map(unpack).sort(newestFirst);
  }

  async get(id: string) {
    const t = (await this.load())[id];
    return t ? unpack(t) : null;
  }

  async count() {
    return Object.keys(await this.load()).length;
  }

  async put(track: Track) {
    (await this.load())[track.id] = pack(track);
    await this.persist();
  }

  async remove(id: string) {
    delete (await this.load())[id];
    await this.persist();
  }
}

// ------------------------------------------------------------------ firestore

export async function createFirestoreStore(databaseId: string): Promise<TrackStore> {
  const { Firestore } = await import('@google-cloud/firestore');
  const db = new Firestore({ databaseId, ignoreUndefinedProperties: true });
  const tracks = db.collection('tracks');

  return {
    async list() {
      const snap = await tracks.get();
      return snap.docs.map((d) => unpack(d.data() as StoredTrack)).sort(newestFirst);
    },
    async get(id) {
      const doc = await tracks.doc(id).get();
      return doc.exists ? unpack(doc.data() as StoredTrack) : null;
    },
    async count() {
      return (await tracks.count().get()).data().count;
    },
    async put(track) {
      await tracks.doc(track.id).set(pack(track));
    },
    async remove(id) {
      await tracks.doc(id).delete();
    },
  };
}
