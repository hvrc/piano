// One shared AudioContext. Browsers start it suspended until a user gesture.

import type { Instrument, Voice } from './instrument';

let ctx: AudioContext | null = null;

export function getAudioContext(): AudioContext {
  return (ctx ??= new AudioContext({ latencyHint: 'interactive' }));
}

export function unlockAudio(): void {
  const c = getAudioContext();
  if (c.state === 'suspended') void c.resume();
}

/** The context time currently reaching the speakers (accounts for output latency). */
export function audibleTime(c: AudioContext): number {
  if (typeof c.getOutputTimestamp === 'function') {
    const ts = c.getOutputTimestamp();
    if (ts.contextTime !== undefined && ts.performanceTime !== undefined && ts.contextTime > 0) {
      return ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
    }
  }
  return c.currentTime - (c.outputLatency || c.baseLatency || 0);
}

/** Start a note right now (for auditioning), unlocking audio on first use. */
export function playNow(instrument: Instrument, pitch: number, velocity: number): Voice {
  unlockAudio();
  return instrument.noteOn(pitch, velocity, getAudioContext().currentTime);
}
