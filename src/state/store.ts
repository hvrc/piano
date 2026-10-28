// Application state: notes, selection, tempo, playback position, grid and edit mode.
// Notes are immutable values; edits replace them, which keeps undo snapshots cheap.
import { DEFAULT_VELOCITY, type Note, type NoteData } from '../model/note';
import type { LoopSettings } from '../model/track';
import type { GridSettings } from '../timeline/grid';

export type { LoopSettings };

export type ChangeKind = 'notes' | 'selection' | 'position' | 'playing' | 'bpm' | 'grid' | 'mode' | 'keyboard' | 'loop';

/** Live's computer MIDI keyboard: A..' play a 1.5-octave range starting at `base`. */
export interface KeyboardSettings {
  enabled: boolean;
  base: number; // MIDI pitch of the A key (a C)
  velocity: number;
}

/** Semitones the computer keyboard covers above its base C (A … ' = C … F). */
export const KEYBOARD_SPAN = 17;

export const DEFAULT_LOOP: LoopSettings = { enabled: false, start: 0, end: 4 };

/** Live's computer MIDI keyboard: A..' play a 1.5-octave range starting at `base`. */
export interface KeyboardSettings {
  enabled: boolean;
  base: number; // MIDI pitch of the A key (a C)
  velocity: number;
}

interface Snapshot {
  notes: Note[];
  selection: number[];
}

const HISTORY_LIMIT = 300;

export class Store {
  notes: Note[] = [];
  selection = new Set<number>();
  bpm = 120;
  position = 0; // beats; the playhead, or where playback resumes when paused
  playing = false;
  grid: GridSettings = { division: 0.25, triplet: false, snap: true };
  drawMode = false;
  keyboard: KeyboardSettings = { enabled: false, base: 60, velocity: 100 };
  loop: LoopSettings = DEFAULT_LOOP;

  private nextId = 1;
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private listeners = new Set<(kind: ChangeKind) => void>();

  subscribe(fn: (kind: ChangeKind) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(kind: ChangeKind): void {
    for (const fn of this.listeners) fn(kind);
  }

  makeNote(pitch: number, start: number, duration: number, velocity = DEFAULT_VELOCITY): Note {
    return { id: this.newId(), pitch, start, duration, velocity };
  }

  newId(): number {
    return this.nextId++;
  }

  // --- notes & selection ---

  setNotes(notes: Note[], selection?: Iterable<number>): void {
    this.notes = notes;
    if (selection) this.selection = new Set(selection);
    else {
      const ids = new Set(notes.map((n) => n.id));
      for (const id of this.selection) if (!ids.has(id)) this.selection.delete(id);
    }
    this.emit('notes');
  }

  /** Add notes (optionally choosing the new selection). */
  appendNotes(notes: Note[], selection?: Iterable<number>): void {
    this.setNotes([...this.notes, ...notes], selection);
  }

  updateNote(id: number, patch: Partial<NoteData>): void {
    this.setNotes(this.notes.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  }

  removeNote(id: number): void {
    this.setNotes(this.notes.filter((n) => n.id !== id));
  }

  setSelection(ids: Iterable<number>): void {
    this.selection = new Set(ids);
    this.emit('selection');
  }

  selectedNotes(): Note[] {
    return this.notes.filter((n) => this.selection.has(n.id));
  }

  /** Replace everything with a freshly opened document (clears selection and history). */
  loadDocument(
    notes: NoteData[],
    bpm: number,
    loop: LoopSettings = DEFAULT_LOOP,
  ): void {
    this.loop = { ...loop };
    this.notes = notes.map((n) => this.makeNote(n.pitch, n.start, n.duration, n.velocity));
    this.selection = new Set();
    this.undoStack = [];
    this.redoStack = [];
    this.bpm = bpm;
    this.position = 0;
    this.emit('notes');
    this.emit('bpm');
    this.emit('position');
    this.emit('loop');
  }

  // --- undo ---

  /** Call before a change you want to be undoable. */
  checkpoint(): void {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(): void {
    const s = this.undoStack.pop();
    if (!s) return;
    this.redoStack.push(this.snapshot());
    this.setNotes(s.notes, s.selection);
  }

  redo(): void {
    const s = this.redoStack.pop();
    if (!s) return;
    this.undoStack.push(this.snapshot());
    this.setNotes(s.notes, s.selection);
  }

  private snapshot(): Snapshot {
    return { notes: this.notes, selection: [...this.selection] };
  }

  // --- transport-facing ---

  setPosition(beat: number): void {
    if (beat === this.position) return;
    this.position = beat;
    this.emit('position');
  }

  setPlaying(playing: boolean): void {
    this.playing = playing;
    this.emit('playing');
  }

  setBpm(bpm: number): void {
    this.bpm = bpm;
    this.emit('bpm');
  }

  // --- editor settings ---

  setGrid(patch: Partial<GridSettings>): void {
    this.grid = { ...this.grid, ...patch };
    this.emit('grid');
  }

  setLoop(patch: Partial<LoopSettings>): void {
    const next = { ...this.loop, ...patch };
    if (next.end - next.start < 1e-6) return;
    this.loop = next;
    this.emit('loop');
  }

  setKeyboard(patch: Partial<KeyboardSettings>): void {
    this.keyboard = { ...this.keyboard, ...patch };
    this.emit('keyboard');
  }

  setDrawMode(on: boolean): void {
    this.drawMode = on;
    this.emit('mode');
  }
}
