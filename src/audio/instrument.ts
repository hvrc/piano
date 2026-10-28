import { clampVelocity } from '../model/note';

// The instrument contract. Anything that can start and release pitched voices at
// precise AudioContext times can be swapped in (e.g. a higher-quality sampled piano).

export interface Voice {
  /** Begin the release phase at the given context time. */
  release(when: number): void;
}

export interface Instrument {
  noteOn(pitch: number, velocity: number, when: number): Voice;
  /** Quickly fade out everything that is sounding or scheduled. */
  allNotesOff(): void;
}

/** Perceptual velocity curve shared by instruments. */
export function velocityGain(velocity: number): number {
  const v = clampVelocity(velocity) / 127;
  return 0.04 + 0.96 * Math.pow(v, 1.7);
}

/** A sounding voice: its output gain, when it started, and how to stop its sources. */
interface Sounding {
  amp: GainNode;
  startedAt: number;
  stop(at: number): void;
}

/** Tracks live voices so allNotesOff can silence them, and builds their release handles. */
export class VoicePool {
  private live = new Set<Sounding>();

  constructor(private ctx: AudioContext) {}

  /**
   * Register a voice. `release` fades it with time constant `releaseTc` and stops its sources
   * `tail` seconds later. Call `ended` when the sources finish.
   */
  add(s: Sounding, releaseTc: number, tail: number): { voice: Voice; ended: () => void } {
    this.live.add(s);
    let released = false;
    const voice: Voice = {
      release: (when) => {
        if (released) return;
        released = true;
        const r = Math.max(when, s.startedAt + 0.01);
        s.amp.gain.cancelScheduledValues(r);
        s.amp.gain.setTargetAtTime(0, r, releaseTc);
        s.stop(r + tail);
      },
    };
    return { voice, ended: () => this.live.delete(s) };
  }

  killAll(): void {
    const now = this.ctx.currentTime;
    for (const s of this.live) {
      s.amp.gain.cancelScheduledValues(now);
      s.amp.gain.setTargetAtTime(0, now, 0.015);
      s.stop(now + 0.1);
    }
    this.live.clear();
  }
}
