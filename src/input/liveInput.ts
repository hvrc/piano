// Notes played live — on the computer keyboard or a MIDI keyboard. Plays them, lights the keys,
// and tells listeners (the recorder) when notes start and stop. The sustain pedal holds MIDI
// notes after their keys are released, for the sound and for what gets recorded.
import { getAudioContext, playNow } from '../audio/context';
import type { Instrument, Voice } from '../audio/instrument';

export type LiveSource = 'computer' | 'midi';

export interface LiveListener {
  noteOn(pitch: number, velocity: number): void;
  noteOff(pitch: number): void;
}

export class LiveInput {
  private voices = new Map<string, { pitch: number; voice: Voice }>();
  private sustained = new Set<string>();
  private pedal = false;
  private listeners = new Set<LiveListener>();

  constructor(
    private instrument: Instrument,
    private onHeld: (pitches: Set<number>) => void,
  ) {
    window.addEventListener('blur', () => this.allOff());
  }

  listen(l: LiveListener): void {
    this.listeners.add(l);
  }

  noteOn(source: LiveSource, pitch: number, velocity: number): void {
    const key = `${source}:${pitch}`;
    if (this.voices.has(key)) this.release(key); // re-struck (e.g. while the pedal holds it)
    this.voices.set(key, { pitch, voice: playNow(this.instrument, pitch, velocity) });
    for (const l of this.listeners) l.noteOn(pitch, velocity);
    this.emitHeld();
  }

  noteOff(source: LiveSource, pitch: number): void {
    const key = `${source}:${pitch}`;
    if (!this.voices.has(key)) return;
    if (source === 'midi' && this.pedal) {
      this.sustained.add(key);
      return;
    }
    this.release(key);
  }

  setPedal(down: boolean): void {
    this.pedal = down;
    if (down) return;
    for (const key of this.sustained) this.release(key);
    this.sustained.clear();
  }

  allOff(): void {
    for (const key of [...this.voices.keys()]) this.release(key);
    this.sustained.clear();
  }

  private release(key: string): void {
    const v = this.voices.get(key);
    if (!v) return;
    v.voice.release(getAudioContext().currentTime);
    this.voices.delete(key);
    this.sustained.delete(key);
    for (const l of this.listeners) l.noteOff(v.pitch);
    this.emitHeld();
  }

  private emitHeld(): void {
    this.onHeld(new Set([...this.voices.values()].map((v) => v.pitch)));
  }
}
