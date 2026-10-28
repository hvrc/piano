// Metronome click: a short pitched blip, higher on the bar's downbeat.
export function scheduleClick(ctx: AudioContext, out: AudioNode, when: number, accent: boolean): void {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = accent ? 1760 : 1175;
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0, when);
  amp.gain.linearRampToValueAtTime(accent ? 0.5 : 0.32, when + 0.002);
  amp.gain.exponentialRampToValueAtTime(0.0001, when + 0.06);
  osc.connect(amp).connect(out);
  osc.start(when);
  osc.stop(when + 0.08);
  osc.onended = () => amp.disconnect();
}
