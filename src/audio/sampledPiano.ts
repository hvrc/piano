// Sampled grand piano: Salamander Grand Piano V3 (Alexander Holm, CC-BY 3.0),
// one sample every minor third from A0 to C8, repitched to fill the gaps.
import { velocityGain, VoicePool, type Instrument, type Voice } from './instrument';

const SAMPLE_PITCH_NAMES: Record<number, string> = { 9: 'A', 0: 'C', 3: 'Ds', 6: 'Fs' };

function sampleFiles(): [number, string][] {
  const out: [number, string][] = [];
  for (let midi = 21; midi <= 108; midi += 3) {
    out.push([midi, `${SAMPLE_PITCH_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}.mp3`]);
  }
  return out;
}

interface Sample {
  buffer: AudioBuffer;
  offset: number; // seconds of leading silence to skip
}

export class SampledPiano implements Instrument {
  ready = false;
  private samples = new Map<number, Sample>();
  private roots: number[] = [];
  private pool: VoicePool;

  constructor(
    private ctx: AudioContext,
    private out: AudioNode,
  ) {
    this.pool = new VoicePool(ctx);
  }

  async load(baseUrl: string): Promise<void> {
    await Promise.all(
      sampleFiles().map(async ([midi, file]) => {
        const res = await fetch(baseUrl + file);
        if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
        const buffer = await this.ctx.decodeAudioData(await res.arrayBuffer());
        this.samples.set(midi, { buffer, offset: onsetOffset(buffer) });
      }),
    );
    this.roots = [...this.samples.keys()].sort((a, b) => a - b);
    this.ready = true;
  }

  noteOn(pitch: number, velocity: number, when: number): Voice {
    const ctx = this.ctx;
    const t = Math.max(when, ctx.currentTime);
    const root = this.nearestRoot(pitch);
    const sample = this.samples.get(root)!;

    const src = ctx.createBufferSource();
    src.buffer = sample.buffer;
    src.playbackRate.value = Math.pow(2, (pitch - root) / 12);

    // Softer notes are darker, like a real hammer.
    const v = velocity / 127;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 1800 + 16000 * v * v;
    tone.Q.value = 0.3;

    const amp = ctx.createGain();
    amp.gain.setValueAtTime(velocityGain(velocity), t);

    src.connect(tone).connect(amp).connect(this.out);
    src.start(t, sample.offset);

    const releaseTc = dampTime(pitch);
    const { voice, ended } = this.pool.add({ amp, startedAt: t, stop: (at) => src.stop(at) }, releaseTc, releaseTc * 8);
    src.onended = () => {
      ended();
      src.disconnect();
      amp.disconnect();
    };
    return voice;
  }

  allNotesOff(): void {
    this.pool.killAll();
  }

  private nearestRoot(pitch: number): number {
    let best = this.roots[0];
    for (const r of this.roots) if (Math.abs(r - pitch) < Math.abs(best - pitch)) best = r;
    return best;
  }
}

/** Damper release time constant: bass strings ring longer than treble. */
function dampTime(pitch: number): number {
  const t = Math.max(0, Math.min(1, (pitch - 21) / 87));
  return 0.22 - 0.15 * t;
}

/** Skip encoder padding / silence before the hammer strike. */
function onsetOffset(buffer: AudioBuffer): number {
  const data = buffer.getChannelData(0);
  const limit = Math.min(data.length, buffer.sampleRate * 0.2);
  for (let i = 0; i < limit; i++) {
    if (Math.abs(data[i]) > 0.003) return Math.max(0, i - 32) / buffer.sampleRate;
  }
  return 0;
}
