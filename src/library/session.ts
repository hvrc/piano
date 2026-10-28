// The open document: which saved track (if any) is loaded, its name, and whether it has
// unsaved changes. Coordinates saving, opening, importing and exporting tracks.
import { decodeMidi, encodeMidi, MidiParseError } from '../midi/smf';
import type { Note, NoteData } from '../model/note';
import type { Transport } from '../playback/transport';
import { DEFAULT_LOOP, type LoopSettings, type Store } from '../state/store';
import { choose, alertError } from '../ui/dialog';
import { storageGet, storageSet } from '../util/storage';
import { deleteTrack, isLibraryKey, libraryKey, listTracks, putTrack, setLibraryKey, type TrackRecord } from './trackStore';

const LAST_TRACK_KEY = 'piano:lastTrack';
const DEFAULT_BPM = 120;
const MAX_IMPORT_BYTES = 8 * 1024 * 1024;

interface SavedState {
  notes: Note[];
  bpm: number;
  loop: LoopSettings;
  name: string;
}

export class Session {
  trackId: string | null = null;
  name = '';
  tracks: TrackRecord[] = [];
  loadError: string | null = null;
  ready = false;
  private saved: SavedState | null = null;
  private listeners = new Set<() => void>();
  private lastDirty = false;

  constructor(
    private store: Store,
    private transport: Transport,
    private onLoaded: () => void,
  ) {
    // Edits only matter to listeners (title dot, sidebar) when they flip the unsaved state, so a
    // drag doesn't re-render the sidebar on every pointer move.
    store.subscribe((k) => {
      if ((k === 'notes' || k === 'bpm' || k === 'loop') && this.dirty !== this.lastDirty) this.emit();
    });
    // A library link opened in a tab that's already on the app only changes the hash.
    window.addEventListener('hashchange', async () => {
      if (!(await this.adoptLibraryFromLink())) return;
      // The open roll belonged to the previous library; keep it on screen as unsaved work.
      this.detach();
      this.emit();
    });
  }

  subscribe(fn: () => void): void {
    this.listeners.add(fn);
  }

  private emit(): void {
    this.lastDirty = this.dirty;
    for (const fn of this.listeners) fn();
  }

  /** The roll is no longer backed by a saved track. */
  private detach(forgetLast = true): void {
    this.trackId = null;
    this.saved = null;
    if (forgetLast) storageSet(LAST_TRACK_KEY, '');
  }

  /** Remember the current document as exactly what `track` holds. */
  private markSaved(id: string, name: string): void {
    this.trackId = id;
    this.name = name;
    this.saved = { notes: this.store.notes, bpm: this.store.bpm, loop: this.store.loop, name };
  }

  /** Notes are immutable and undo restores old arrays, so reference equality tracks edits exactly. */
  get dirty(): boolean {
    const s = this.store;
    if (!this.saved) return s.notes.length > 0;
    return (
      s.notes !== this.saved.notes ||
      s.bpm !== this.saved.bpm ||
      !sameLoop(s.loop, this.saved.loop) ||
      this.name !== this.saved.name
    );
  }

  async init(): Promise<void> {
    await this.refresh();
    await this.adoptLibraryFromLink();
    const last = storageGet(LAST_TRACK_KEY);
    const track = this.tracks.find((t) => t.id === last);
    if (track) this.load(track);
    this.ready = true;
    this.emit();
  }

  private async refresh(): Promise<void> {
    try {
      this.tracks = await listTracks();
      this.loadError = null;
    } catch (err) {
      console.warn('[piano] could not load saved tracks', err);
      this.loadError = 'Couldn’t load saved tracks. Is the server running?';
    }
  }

  /** /#library=KEY switches this device to a shared library (asking first if it would hide tracks). */
  private async adoptLibraryFromLink(): Promise<boolean> {
    const key = new URLSearchParams(location.hash.slice(1)).get('library');
    if (key === null) return false;
    history.replaceState(null, '', location.pathname + location.search);
    if (!isLibraryKey(key) || key === libraryKey()) return false;
    if (this.tracks.length > 0) {
      const choice = await choose(
        'Open the library from this link?',
        `This device will switch to the linked library. Its current library (${this.tracks.length} track${
          this.tracks.length === 1 ? '' : 's'
        }) stays saved, but you’ll need its own link to get back to it — copy that first if you want it.`,
        [
          { label: 'Cancel', value: 'cancel' },
          { label: 'Switch library', value: 'switch', primary: true },
        ],
      );
      if (choice !== 'switch') return false;
    }
    setLibraryKey(key);
    await this.refresh();
    return true;
  }

  setName(name: string): void {
    this.name = name;
    this.emit();
  }

  // ------------------------------------------------------------- saving

  async save(asCopy = false): Promise<void> {
    const now = Date.now();
    const isNew = asCopy || !this.trackId;
    let name = this.name.trim() || 'Untitled';
    if (isNew) name = this.uniqueName(asCopy && this.trackId ? `${name} copy` : name);
    const id = isNew ? crypto.randomUUID() : this.trackId!;
    const existing = this.tracks.find((t) => t.id === id);
    const record: TrackRecord = {
      id,
      name,
      bpm: this.store.bpm,
      notes: this.store.notes.map(toData),
      loop: { ...this.store.loop },
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    try {
      Object.assign(record, await putTrack(record));
    } catch (err) {
      await alertError('Couldn’t save the track', errorText(err));
      return;
    }
    this.markSaved(id, name);
    this.tracks = [record, ...this.tracks.filter((t) => t.id !== id)];
    storageSet(LAST_TRACK_KEY, id);
    this.emit();
  }

  // ------------------------------------------------------------- opening

  async open(id: string): Promise<void> {
    if (id === this.trackId) return;
    const track = this.tracks.find((t) => t.id === id);
    if (!track || !(await this.confirmDiscard())) return;
    this.load(track);
    storageSet(LAST_TRACK_KEY, id);
  }

  async newTrack(): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    this.replaceDocument([], DEFAULT_BPM);
    this.detach();
    this.name = '';
    this.emit();
  }

  async remove(id: string): Promise<void> {
    try {
      await deleteTrack(id);
    } catch (err) {
      await alertError('Couldn’t delete the track', errorText(err));
      return;
    }
    this.tracks = this.tracks.filter((t) => t.id !== id);
    if (id === this.trackId) this.detach(); // keep the roll on screen as unsaved work
    this.emit();
  }

  private load(track: TrackRecord): void {
    this.replaceDocument(track.notes, track.bpm, track.loop ?? DEFAULT_LOOP);
    this.markSaved(track.id, track.name);
    this.emit();
  }

  private replaceDocument(notes: NoteData[], bpm: number, loop: LoopSettings = DEFAULT_LOOP): void {
    this.transport.pause();
    this.store.loadDocument(notes, bpm, loop);
    this.onLoaded();
  }

  /** Ask before throwing away unsaved work. Resolves false if the user cancels. */
  private async confirmDiscard(): Promise<boolean> {
    if (!this.dirty) return true;
    const choice = await choose(
      `Save changes to “${this.name.trim() || 'Untitled'}”?`,
      'Your changes will be lost if you don’t save them.',
      [
        { label: 'Cancel', value: 'cancel' },
        { label: 'Don’t Save', value: 'discard', danger: true },
        { label: 'Save', value: 'save', primary: true },
      ],
    );
    if (choice === 'save') await this.save();
    return choice !== 'cancel';
  }

  // ------------------------------------------------------------- MIDI

  async importFile(file: File): Promise<void> {
    let song;
    try {
      if (file.size > MAX_IMPORT_BYTES) throw new MidiParseError('The file is too large.');
      song = decodeMidi(await file.arrayBuffer());
      if (!song.notes.length) throw new MidiParseError('The file has no notes.');
    } catch (err) {
      const detail = err instanceof MidiParseError ? err.message : 'The file could not be read as MIDI.';
      await alertError(`Couldn’t open “${file.name}”`, detail);
      return;
    }
    if (!(await this.confirmDiscard())) return;
    this.replaceDocument(song.notes, song.bpm);
    this.detach(false);
    this.name = file.name.replace(/\.(mid|midi)$/i, '') || song.name || 'Imported';
    this.emit();
  }

  download(): void {
    const name = this.name.trim() || 'Untitled';
    saveFile(`${fileSafe(name)}.mid`, encodeMidi({ name, bpm: this.store.bpm, notes: this.store.notes.map(toData) }));
  }

  downloadTrack(track: TrackRecord): void {
    saveFile(`${fileSafe(track.name)}.mid`, encodeMidi(track));
  }

  private uniqueName(base: string): string {
    const taken = new Set(this.tracks.filter((t) => t.id !== this.trackId).map((t) => t.name));
    if (!taken.has(base)) return base;
    let i = 2;
    while (taken.has(`${base} ${i}`)) i++;
    return `${base} ${i}`;
  }
}

function sameLoop(a: LoopSettings, b: LoopSettings): boolean {
  return a.enabled === b.enabled && a.start === b.start && a.end === b.end;
}

function toData({ id: _id, ...data }: Note): NoteData {
  return data;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function fileSafe(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'track';
}

function saveFile(filename: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'audio/midi' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
