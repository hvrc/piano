// Keeps the playhead in view during playback, like Live 12's "Scroll" follow behaviour: once the
// playhead reaches the middle of the view it stays there and the grid glides underneath. A loop
// that fits on screen is kept in view instead, so the playhead cycles inside it. If the user
// scrolls the playhead out of sight, following pauses until it is visible again. With Follow
// switched off (the F key) the view stays wherever the user leaves it.
import type { Store } from '../state/store';
import type { Viewport } from '../timeline/viewport';
import { prefs } from '../state/prefs';

const FOLLOW_AT = 0.5; // fraction of the view width where the playhead settles

export class PlayheadFollow {
  private armed = true;
  private lastBeat = 0;

  constructor(
    private store: Store,
    private vp: Viewport,
  ) {}

  /** Bring the playhead into view if it is off-screen (after play, seek, or opening a track). */
  reveal(beat = this.store.position): void {
    const { vp } = this;
    const x = vp.beatToX(beat);
    if (x < 0 || x > vp.width - 8) vp.scrollTo(beat * vp.pxPerBeat - vp.width * 0.1, vp.scrollY);
    this.armed = true;
    this.lastBeat = beat;
  }

  /** Called every frame while playing. */
  tick(beat: number): void {
    if (!prefs.value.follow) return;
    const { vp } = this;
    const ppb = vp.pxPerBeat;
    const x = vp.beatToX(beat);
    const visible = x >= 0 && x <= vp.width;
    const wrapped = beat < this.lastBeat - 1e-6;
    this.lastBeat = beat;
    if (visible) this.armed = true;
    else if (!wrapped) this.armed = false; // the user scrolled away
    if (!this.armed) return;

    const loop = this.store.loop;
    const inLoop = loop.enabled && beat >= loop.start && beat < loop.end;
    if (inLoop && (loop.end - loop.start) * ppb <= vp.width * 0.9) {
      if (vp.beatToX(loop.start) < 0 || vp.beatToX(loop.end) > vp.width) {
        vp.scrollTo(loop.start * ppb - vp.width * 0.05, vp.scrollY);
      }
      return;
    }
    const target = beat * ppb - vp.width * FOLLOW_AT;
    if (target > vp.scrollX || (wrapped && !visible)) vp.scrollTo(target, vp.scrollY);
  }
}
