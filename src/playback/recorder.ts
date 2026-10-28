// Records live notes (computer or MIDI keyboard) into the roll while the transport plays. Each note
// starts at the beat you heard when you played it and grows until you let go (or the pedal lifts).
// A whole take is one undo step.
import type { LiveListener } from '../input/liveInput';
import { noteEnd } from '../model/note';
import type { Store } from '../state/store';
import type { Transport } from './transport';

const MIN_LENGTH = 1 / 64; // beats

export class Recorder implements LiveListener {
  private open = new Map<number, { id: number; start: number }>();

  constructor(
    private store: Store,
    private transport: Transport,
  ) {
    store.subscribe((k) => {
      if (k === 'playing' && !store.playing && store.recording) this.stop();
    });
  }

  toggle(): void {
    if (this.store.recording) this.stop();
    else this.start();
  }

  start(): void {
    this.store.checkpoint(); // the take is one undo step
    this.store.setRecording(true);
    if (!this.store.playing) this.transport.play();
  }

  stop(): void {
    const beat = this.transport.currentBeat();
    for (const pitch of [...this.open.keys()]) this.finish(pitch, beat);
    this.store.setRecording(false);
  }

  noteOn(pitch: number, velocity: number): void {
    if (!this.store.recording || !this.store.playing) return;
    const beat = this.transport.currentBeat();
    if (this.open.has(pitch)) this.finish(pitch, beat);
    const note = this.store.makeNote(pitch, beat, MIN_LENGTH, velocity);
    this.store.appendNotes([note], this.store.selection);
    this.open.set(pitch, { id: note.id, start: beat });
  }

  noteOff(pitch: number): void {
    if (this.open.has(pitch)) this.finish(pitch, this.transport.currentBeat());
  }

  /** Called every frame while playing: grow the notes that are still held. */
  tick(beat: number): void {
    if (!this.open.size) return;
    const loop = this.store.loop;
    const grow = new Map<number, number>();
    for (const [pitch, o] of this.open) {
      if (beat < o.start) {
        // The loop wrapped: the held note ends at the loop end.
        this.finish(pitch, loop.end);
        continue;
      }
      grow.set(o.id, Math.max(MIN_LENGTH, beat - o.start));
    }
    if (!grow.size) return;
    this.store.setNotes(this.store.notes.map((n) => (grow.has(n.id) ? { ...n, duration: grow.get(n.id)! } : n)));
  }

  private finish(pitch: number, beat: number): void {
    const o = this.open.get(pitch);
    if (!o) return;
    this.open.delete(pitch);
    const note = this.store.notes.find((n) => n.id === o.id);
    if (!note) return;
    const duration = Math.max(MIN_LENGTH, beat - o.start);
    if (Math.abs(noteEnd(note) - (o.start + duration)) > 1e-9) this.store.updateNote(o.id, { duration });
  }
}
