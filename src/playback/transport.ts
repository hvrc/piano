// Transport: play / pause / seek / tempo, with a lookahead scheduler.
// A short JS timer schedules note events slightly ahead on the AudioContext clock,
// so timing is sample-accurate regardless of main-thread jitter.
import { audibleTime, getAudioContext, unlockAudio } from '../audio/context';
import type { Instrument } from '../audio/instrument';
import type { Store } from '../state/store';

const TICK_MS = 25;
const LOOKAHEAD_S = 0.12;
const HIDDEN_LOOKAHEAD_S = 1.5; // background tabs throttle timers to ~1s
const START_DELAY_S = 0.03;

export class Transport {
  private anchorTime = 0; // context time at which anchorBeat sounds
  private anchorBeat = 0;
  private startBeat = 0;
  private scheduledUntil = 0; // beats
  private timer = 0;

  constructor(
    private store: Store,
    private instrument: Instrument,
  ) {}

  get playing(): boolean {
    return this.store.playing;
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  play(): void {
    if (this.playing) return;
    unlockAudio();
    this.reanchor(this.store.position);
    this.store.setPlaying(true);
    this.tick();
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  pause(): void {
    if (!this.playing) return;
    const beat = this.currentBeat();
    window.clearInterval(this.timer);
    this.instrument.allNotesOff();
    this.store.setPlaying(false);
    this.store.setPosition(beat);
  }

  seek(beat: number): void {
    beat = Math.max(0, beat);
    if (this.playing) {
      this.instrument.allNotesOff();
      this.reanchor(beat);
      this.tick();
    }
    this.store.setPosition(beat);
  }

  setBpm(bpm: number): void {
    if (this.playing) {
      // Keep everything already scheduled where it is; the new tempo takes over from there.
      const t = this.timeOf(this.scheduledUntil);
      this.anchorBeat = this.scheduledUntil;
      this.anchorTime = t;
    }
    this.store.setBpm(bpm);
  }

  /** The beat currently being heard. */
  currentBeat(): number {
    if (!this.playing) return this.store.position;
    return Math.max(this.startBeat, this.beatAt(audibleTime(getAudioContext())));
  }

  private reanchor(beat: number): void {
    const ctx = getAudioContext();
    this.anchorBeat = this.startBeat = this.scheduledUntil = beat;
    this.anchorTime = ctx.currentTime + START_DELAY_S;
  }

  private beatAt(time: number): number {
    return this.anchorBeat + ((time - this.anchorTime) * this.store.bpm) / 60;
  }

  private timeOf(beat: number): number {
    return this.anchorTime + ((beat - this.anchorBeat) * 60) / this.store.bpm;
  }

  private tick(): void {
    const ctx = getAudioContext();
    const lookahead = document.hidden ? HIDDEN_LOOKAHEAD_S : LOOKAHEAD_S;
    const from = this.scheduledUntil;
    const until = this.beatAt(ctx.currentTime + lookahead);
    if (until <= from) return;
    for (const n of this.store.notes) {
      if (n.start >= from && n.start < until) {
        const voice = this.instrument.noteOn(n.pitch, n.velocity, this.timeOf(n.start));
        voice.release(this.timeOf(n.start + n.duration));
      }
    }
    this.scheduledUntil = until;
  }
}
