// Master bus: gentle room reverb, a compressor to even out stacked chords, makeup gain, then a
// limiter so the (now much louder) piano never clips.

const INPUT_GAIN = 2.1; // three times the original 0.7: full velocity was too quiet
const MAKEUP_GAIN = 1.4;

export function createMasterBus(ctx: AudioContext): AudioNode {
  const input = ctx.createGain();
  input.gain.value = INPUT_GAIN;

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12;
  comp.knee.value = 12;
  comp.ratio.value = 3;
  comp.attack.value = 0.004;
  comp.release.value = 0.25;

  const reverb = ctx.createConvolver();
  reverb.buffer = roomImpulse(ctx, 2.4, 3.2);
  const wet = ctx.createGain();
  wet.gain.value = 0.16;

  const makeup = ctx.createGain();
  makeup.gain.value = MAKEUP_GAIN;

  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -1.5;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.1;

  input.connect(comp);
  input.connect(reverb).connect(wet).connect(comp);
  comp.connect(makeup).connect(limiter).connect(ctx.destination);
  return input;
}

function roomImpulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  const predelay = Math.floor(ctx.sampleRate * 0.012);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = predelay; i < len; i++) {
      const t = (i - predelay) / (len - predelay);
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
    }
  }
  return buf;
}
