// The app's piano: the sampled grand once loaded, the synth until then.
import type { Instrument, Voice } from './instrument';
import { SampledPiano } from './sampledPiano';
import { SynthPiano } from './synthPiano';

/** Voices the pedal can hold at once; past this the oldest is damped (they've long decayed anyway). */
const MAX_HELD = 256;

export type PianoStatus = 'loading' | 'sampled' | 'synth';

export class Piano implements Instrument {
  status: PianoStatus = 'loading';
  private sampled: SampledPiano;
  private synth: SynthPiano;
  private sustain = false;
  /** Voices whose keys were released while the pedal was down, with when their key went up. */
  private held = new Map<Voice, number>();

  constructor(ctx: AudioContext, out: AudioNode) {
    this.sampled = new SampledPiano(ctx, out);
    this.synth = new SynthPiano(ctx, out);
  }

  async load(baseUrl: string): Promise<PianoStatus> {
    try {
      await this.sampled.load(baseUrl);
      this.status = 'sampled';
    } catch (err) {
      console.warn('[piano] samples failed to load, using synth', err);
      this.status = 'synth';
    }
    return this.status;
  }

  noteOn(pitch: number, velocity: number, when: number): Voice {
    const voice = (this.sampled.ready ? this.sampled : this.synth).noteOn(pitch, velocity, when);
    return {
      release: (at) => {
        if (!this.sustain) return voice.release(at);
        // Pedal down: the key is up but the damper stays off, so the note rings on and decays.
        this.held.set(voice, at);
        if (this.held.size > MAX_HELD) {
          const [oldest, t] = this.held.entries().next().value!;
          this.held.delete(oldest);
          oldest.release(t);
        }
      },
    };
  }

  /** Sustain (a damper pedal held down): releases wait until it's lifted. Covers playback and live notes. */
  setSustain(on: boolean, now: number): void {
    this.sustain = on;
    if (on) return;
    // Lifting the pedal damps what it was holding — but not notes whose keys are still down.
    for (const [voice, at] of this.held) voice.release(Math.max(at, now));
    this.held.clear();
  }

  allNotesOff(): void {
    this.held.clear();
    this.sampled.allNotesOff();
    this.synth.allNotesOff();
  }
}
