// Note-editing operations shared by mouse and keyboard. Each one is a single undo step.
import { clampPitch, MAX_PITCH, MIN_PITCH } from '../music/pitch';
import { clampVelocity, noteBounds, notesEnd, type Note } from '../model/note';
import type { Store } from '../state/store';
import { BEATS_PER_BAR, EPS, gridStep, snapCeil } from '../timeline/grid';
import { humanize, legato, type HumanizeOptions } from './transforms';

let clipboard: Note[] = [];

export function deleteSelected(store: Store): void {
  if (store.selection.size === 0) return;
  store.checkpoint();
  store.setNotes(store.notes.filter((n) => !store.selection.has(n.id)), []);
}

export function deleteNote(store: Store, id: number): void {
  store.checkpoint();
  store.removeNote(id);
}

export function addNote(store: Store, pitch: number, start: number, duration: number): Note {
  const note = store.makeNote(clampPitch(pitch), Math.max(0, start), duration);
  store.checkpoint();
  store.appendNotes([note], [note.id]);
  return note;
}

export function selectAll(store: Store): void {
  store.setSelection(store.notes.map((n) => n.id));
}

export function transposeSelected(store: Store, semitones: number): void {
  const sel = store.selectedNotes();
  if (!sel.length) return;
  const { lo, hi } = noteBounds(sel);
  const d = Math.max(MIN_PITCH - lo, Math.min(MAX_PITCH - hi, semitones));
  if (d !== 0) updateSelected(store, (n) => ({ ...n, pitch: n.pitch + d }));
}

export function moveSelected(store: Store, beats: number): void {
  const sel = store.selectedNotes();
  if (!sel.length) return;
  const d = Math.max(-noteBounds(sel).start, beats);
  if (Math.abs(d) >= EPS) updateSelected(store, (n) => ({ ...n, start: n.start + d }));
}

export function resizeSelected(store: Store, beats: number): void {
  const min = gridStep(store.grid);
  updateSelected(store, (n) => ({ ...n, duration: Math.max(Math.min(min, n.duration), n.duration + beats) }));
}

export function changeVelocity(store: Store, delta: number): void {
  updateSelected(store, (n) => ({ ...n, velocity: clampVelocity(n.velocity + delta) }));
}

/** Copy the selection to just after itself (Cmd+D), rounding the offset to a musical unit. */
export function duplicateSelected(store: Store): void {
  const sel = store.selectedNotes();
  if (!sel.length) return;
  const span = notesEnd(sel) - noteBounds(sel).start;
  const unit = span >= 2 ? BEATS_PER_BAR : span >= 0.5 ? 1 : gridStep(store.grid);
  pasteCopies(store, sel, Math.max(unit, snapCeil(span, unit)));
}

export function copySelected(store: Store): void {
  const sel = store.selectedNotes();
  if (!sel.length) return;
  const start = noteBounds(sel).start;
  clipboard = sel.map((n) => ({ ...n, start: n.start - start }));
}

export function cutSelected(store: Store): void {
  copySelected(store);
  deleteSelected(store);
}

/** Paste at the playhead / insert position. Returns the beat just after the pasted notes. */
export function paste(store: Store, at: number): number | null {
  if (!clipboard.length) return null;
  pasteCopies(store, clipboard, at);
  return at + notesEnd(clipboard);
}

export function humanizeNotes(store: Store, opts: HumanizeOptions): void {
  replaceTargets(store, (notes) => humanize(notes, store.bpm, opts));
}

export function legatoNotes(store: Store): void {
  replaceTargets(store, legato);
}

/** Add copies of `notes` shifted by `offset` beats, and select them. */
function pasteCopies(store: Store, notes: Note[], offset: number): void {
  const copies = notes.map((n) => ({ ...n, id: store.newId(), start: n.start + offset }));
  store.checkpoint();
  store.appendNotes(copies, copies.map((n) => n.id));
}

function updateSelected(store: Store, fn: (n: Note) => Note): void {
  if (!store.selection.size) return;
  store.checkpoint();
  store.setNotes(store.notes.map((n) => (store.selection.has(n.id) ? fn(n) : n)));
}

/** Apply a whole-group transform to the selected notes, or to every note when nothing is selected. */
function replaceTargets(store: Store, fn: (notes: Note[]) => Note[]): void {
  const chosen = store.selection.size ? store.selectedNotes() : store.notes;
  if (!chosen.length) return;
  const updated = new Map(fn(chosen).map((n) => [n.id, n]));
  store.checkpoint();
  store.setNotes(store.notes.map((n) => updated.get(n.id) ?? n));
}
