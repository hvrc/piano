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
  const v = Math.max(1, Math.min(127, velocity)) / 127;
  return 0.04 + 0.96 * Math.pow(v, 1.7);
}

/** Tracks live voices so allNotesOff can release them. */
export class VoicePool<T extends { kill(when: number): void }> {
  private voices = new Set<T>();

  add(v: T): void {
    this.voices.add(v);
  }

  remove(v: T): void {
    this.voices.delete(v);
  }

  killAll(when: number): void {
    for (const v of this.voices) v.kill(when);
    this.voices.clear();
  }
}
