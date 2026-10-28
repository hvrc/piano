// Lightweight synthesized piano. Used while samples load, or if they fail to.
import { velocityGain, VoicePool, type Instrument, type Voice } from './instrument';

interface LiveVoice {
  kill(when: number): void;
}

export class SynthPiano implements Instrument {
  private pool = new VoicePool<LiveVoice>();

  constructor(
    private ctx: AudioContext,
    private out: AudioNode,
  ) {}

  noteOn(pitch: number, velocity: number, when: number): Voice {
    const ctx = this.ctx;
    const t = Math.max(when, ctx.currentTime);
    const freq = 440 * Math.pow(2, (pitch - 69) / 12);
    const peak = velocityGain(velocity) * 0.45;
    const decay = Math.max(0.25, Math.min(4, 1.8 * Math.pow(2, -(pitch - 60) / 18)));

    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(peak, t + 0.004);
    amp.gain.setTargetAtTime(0, t + 0.004, decay);

    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.setValueAtTime(Math.min(16000, freq * (4 + 8 * (velocity / 127))), t);
    tone.frequency.setTargetAtTime(freq * 2, t, decay * 0.5);

    const oscs = [
      { type: 'triangle' as OscillatorType, mult: 1, gain: 1 },
      { type: 'sine' as OscillatorType, mult: 2, gain: 0.35 },
      { type: 'sine' as OscillatorType, mult: 3.01, gain: 0.12 },
    ].map(({ type, mult, gain }) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq * mult;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g).connect(tone);
      o.start(t);
      o.stop(t + decay * 7);
      return o;
    });
    tone.connect(amp).connect(this.out);

    const stopAll = (at: number) => oscs.forEach((o) => o.stop(at));
    const live: LiveVoice = {
      kill: (when) => {
        const r = Math.max(when, ctx.currentTime);
        amp.gain.cancelScheduledValues(r);
        amp.gain.setTargetAtTime(0, r, 0.015);
        stopAll(r + 0.1);
      },
    };
    this.pool.add(live);
    oscs[0].onended = () => {
      this.pool.remove(live);
      amp.disconnect();
    };

    let released = false;
    return {
      release: (when) => {
        if (released) return;
        released = true;
        const r = Math.max(when, t + 0.01);
        amp.gain.cancelScheduledValues(r);
        amp.gain.setTargetAtTime(0, r, 0.08);
        stopAll(r + 0.6);
      },
    };
  }

  allNotesOff(): void {
    this.pool.killAll(this.ctx.currentTime);
  }
}
