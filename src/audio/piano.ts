// The app's piano: the sampled grand once loaded, the synth until then.
import type { Instrument, Voice } from './instrument';
import { SampledPiano } from './sampledPiano';
import { SynthPiano } from './synthPiano';

export type PianoStatus = 'loading' | 'sampled' | 'synth';

export class Piano implements Instrument {
  status: PianoStatus = 'loading';
  private sampled: SampledPiano;
  private synth: SynthPiano;

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
    return (this.sampled.ready ? this.sampled : this.synth).noteOn(pitch, velocity, when);
  }

  allNotesOff(): void {
    this.sampled.allNotesOff();
    this.synth.allNotesOff();
  }
}
