// Transport: play / pause / seek / tempo / loop, with a lookahead scheduler.
// A short JS timer schedules note events slightly ahead on the AudioContext clock,
// so timing is sample-accurate regardless of main-thread jitter.
//
// Playback is a list of "segments": each maps a context time to a beat at a tempo. A new
// segment starts on play/seek, on a tempo change, and each time the loop wraps around.
// The playhead is drawn by finding the segment that is audible right now.
import { audibleTime, getAudioContext, unlockAudio } from '../audio/context';
import type { Instrument } from '../audio/instrument';
import type { Store } from '../state/store';

const TICK_MS = 25;
const LOOKAHEAD_S = 0.12;
const HIDDEN_LOOKAHEAD_S = 1.5; // background tabs throttle timers to ~1s
const START_DELAY_S = 0.03;
const EPS = 1e-9;

interface Segment {
  time: number; // context time at which `beat` sounds
  beat: number;
  bpm: number;
}

export class Transport {
  private segments: Segment[] = [];
  private scheduledUntil = 0; // beats, within the newest segment
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
    this.restart(this.store.position);
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
      this.restart(beat);
      this.tick();
    }
    this.store.setPosition(beat);
  }

  setBpm(bpm: number): void {
    if (this.playing) {
      // Keep everything already scheduled where it is; the new tempo takes over from there.
      this.segments.push({ time: this.timeOf(this.scheduledUntil), beat: this.scheduledUntil, bpm });
    }
    this.store.setBpm(bpm);
  }

  /** The beat currently being heard. */
  currentBeat(): number {
    if (!this.playing || !this.segments.length) return this.store.position;
    const t = audibleTime(getAudioContext());
    let seg = this.segments[0];
    for (const s of this.segments) if (s.time <= t) seg = s;
    // Drop segments that are fully in the past.
    const i = this.segments.indexOf(seg);
    if (i > 0) this.segments.splice(0, i);
    return Math.max(seg.beat, seg.beat + ((t - seg.time) * seg.bpm) / 60);
  }

  private restart(beat: number): void {
    this.segments = [{ time: getAudioContext().currentTime + START_DELAY_S, beat, bpm: this.store.bpm }];
    this.scheduledUntil = beat;
  }

  private get head(): Segment {
    return this.segments[this.segments.length - 1];
  }

  private beatAt(time: number): number {
    const s = this.head;
    return s.beat + ((time - s.time) * s.bpm) / 60;
  }

  private timeOf(beat: number): number {
    const s = this.head;
    return s.time + ((beat - s.beat) * 60) / s.bpm;
  }

  /** Loop end to wrap at, if the loop is on and playback in this segment started before its end. */
  private loopEnd(): number | null {
    const { enabled, start, end } = this.store.loop;
    if (!enabled || end <= start || this.head.beat >= end - EPS) return null;
    return end;
  }

  private tick(): void {
    const ctx = getAudioContext();
    const horizon = ctx.currentTime + (document.hidden ? HIDDEN_LOOKAHEAD_S : LOOKAHEAD_S);
    for (let guard = 0; guard < 64; guard++) {
      const loopEnd = this.loopEnd();
      const until = Math.min(this.beatAt(horizon), loopEnd ?? Infinity);
      if (until > this.scheduledUntil) this.schedule(this.scheduledUntil, until, loopEnd);
      this.scheduledUntil = Math.max(this.scheduledUntil, until);
      if (loopEnd === null || this.scheduledUntil < loopEnd - EPS) return;
      // Wrap: the loop start sounds exactly when the loop end would have.
      const { start } = this.store.loop;
      const time = Math.max(this.timeOf(loopEnd), ctx.currentTime);
      this.segments.push({ time, beat: start, bpm: this.head.bpm });
      this.scheduledUntil = start;
    }
  }

  private schedule(from: number, until: number, loopEnd: number | null): void {
    for (const n of this.store.notes) {
      if (n.start < from - EPS || n.start >= until - EPS) continue;
      const end = loopEnd === null ? n.start + n.duration : Math.min(n.start + n.duration, loopEnd);
      const voice = this.instrument.noteOn(n.pitch, n.velocity, this.timeOf(n.start));
      voice.release(this.timeOf(end));
    }
  }
}
