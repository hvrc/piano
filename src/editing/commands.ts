// Note-editing operations shared by mouse and keyboard. Each one is a single undo step.
import { clampPitch, MAX_PITCH, MIN_PITCH } from '../music/pitch';
import { noteEnd, type Note } from '../model/note';
import type { Store } from '../state/store';
import { BEATS_PER_BAR, EPS, gridStep } from '../timeline/grid';

let clipboard: Note[] = [];

export function deleteSelected(store: Store): void {
  if (store.selection.size === 0) return;
  store.checkpoint();
  store.setNotes(store.notes.filter((n) => !store.selection.has(n.id)), []);
}

export function deleteNote(store: Store, id: number): void {
  store.checkpoint();
  store.setNotes(store.notes.filter((n) => n.id !== id));
}

export function addNote(store: Store, pitch: number, start: number, duration: number): Note {
  const note = store.makeNote(clampPitch(pitch), Math.max(0, start), duration);
  store.checkpoint();
  store.setNotes([...store.notes, note], [note.id]);
  return note;
}

export function selectAll(store: Store): void {
  store.setSelection(store.notes.map((n) => n.id));
}

export function transposeSelected(store: Store, semitones: number): void {
  const sel = store.selectedNotes();
  if (!sel.length) return;
  const lo = Math.min(...sel.map((n) => n.pitch));
  const hi = Math.max(...sel.map((n) => n.pitch));
  const d = Math.max(MIN_PITCH - lo, Math.min(MAX_PITCH - hi, semitones));
  if (d === 0) return;
  updateSelected(store, (n) => ({ ...n, pitch: n.pitch + d }));
}

export function moveSelected(store: Store, beats: number): void {
  const sel = store.selectedNotes();
  if (!sel.length) return;
  const d = Math.max(-Math.min(...sel.map((n) => n.start)), beats);
  if (Math.abs(d) < EPS) return;
  updateSelected(store, (n) => ({ ...n, start: n.start + d }));
}

export function resizeSelected(store: Store, beats: number): void {
  if (!store.selection.size) return;
  const min = gridStep(store.grid);
  updateSelected(store, (n) => ({ ...n, duration: Math.max(Math.min(min, n.duration), n.duration + beats) }));
}

/** Copy the selection to just after itself (Cmd+D), rounding the offset to a musical unit. */
export function duplicateSelected(store: Store): void {
  const sel = store.selectedNotes();
  if (!sel.length) return;
  const start = Math.min(...sel.map((n) => n.start));
  const span = Math.max(...sel.map(noteEnd)) - start;
  const unit = span >= 2 ? BEATS_PER_BAR : span >= 0.5 ? 1 : gridStep(store.grid);
  const offset = Math.max(unit, Math.ceil(span / unit - EPS) * unit);
  const copies = sel.map((n) => ({ ...n, id: store.newId(), start: n.start + offset }));
  store.checkpoint();
  store.setNotes([...store.notes, ...copies], copies.map((n) => n.id));
}

export function copySelected(store: Store): void {
  const sel = store.selectedNotes();
  if (!sel.length) return;
  const start = Math.min(...sel.map((n) => n.start));
  clipboard = sel.map((n) => ({ ...n, start: n.start - start }));
}

export function cutSelected(store: Store): void {
  copySelected(store);
  deleteSelected(store);
}

/** Paste at the playhead / insert position and move the position past the pasted notes. */
export function paste(store: Store, at: number): number | null {
  if (!clipboard.length) return null;
  const copies = clipboard.map((n) => ({ ...n, id: store.newId(), start: n.start + at }));
  store.checkpoint();
  store.setNotes([...store.notes, ...copies], copies.map((n) => n.id));
  return at + Math.max(...clipboard.map(noteEnd));
}

function updateSelected(store: Store, fn: (n: Note) => Note): void {
  store.checkpoint();
  store.setNotes(store.notes.map((n) => (store.selection.has(n.id) ? fn(n) : n)));
}
