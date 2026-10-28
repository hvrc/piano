// Maps musical time and pitch to pixels inside the note grid, and owns scroll/zoom.
// x is relative to the grid's left edge, y to the grid's top edge.
import { PITCH_COUNT } from '../music/pitch';

const MIN_PX_PER_BEAT = 6;
const MAX_PX_PER_BEAT = 1600;
const MIN_ROW = 6;
const MAX_ROW = 40;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Breathing room before beat 1, so bar 1 doesn't sit on the keyboard's edge. */
const START_GUTTER = 16;

export class Viewport {
  pxPerBeat = 72;
  scrollX = -START_GUTTER;
  scrollY = 0;
  width = 0;
  height = 0;
  contentBeats = 128;
  private rowF = 16;
  private pendingCenter: number | null = null;

  /** Called after any scroll, zoom or resize, so the app can repaint in one place. */
  onChange: () => void = () => {};

  get rowHeight(): number {
    return Math.round(this.rowF);
  }

  beatToX(beat: number): number {
    return beat * this.pxPerBeat - this.scrollX;
  }

  xToBeat(x: number): number {
    return (x + this.scrollX) / this.pxPerBeat;
  }

  pitchToY(pitch: number): number {
    return (PITCH_COUNT - 1 - pitch) * this.rowHeight - this.scrollY;
  }

  /** May return values outside 0–127 when y is past the keyboard. */
  yToPitch(y: number): number {
    return PITCH_COUNT - 1 - Math.floor((y + this.scrollY) / this.rowHeight);
  }

  get maxScrollX(): number {
    return Math.max(0, this.contentBeats * this.pxPerBeat - this.width);
  }

  get maxScrollY(): number {
    return Math.max(0, PITCH_COUNT * this.rowHeight - this.height);
  }

  scrollTo(x: number, y: number): void {
    this.scrollX = clamp(x, -START_GUTTER, this.maxScrollX);
    this.scrollY = clamp(y, 0, this.maxScrollY);
    this.onChange();
  }

  /** Scroll horizontally back to the start of the roll. */
  scrollToStart(): void {
    this.scrollTo(-START_GUTTER, this.scrollY);
  }

  scrollBy(dx: number, dy: number): void {
    this.scrollTo(this.scrollX + dx, this.scrollY + dy);
  }

  /** Zoom time around a fixed x so the beat under the cursor stays put. */
  zoomX(factor: number, anchorX: number): void {
    const beat = this.xToBeat(anchorX);
    this.pxPerBeat = clamp(this.pxPerBeat * factor, MIN_PX_PER_BEAT, MAX_PX_PER_BEAT);
    this.scrollTo(beat * this.pxPerBeat - anchorX, this.scrollY);
  }

  /** Zoom key height around a fixed y. */
  zoomY(factor: number, anchorY: number): void {
    const rows = (anchorY + this.scrollY) / this.rowHeight;
    this.rowF = clamp(this.rowF * factor, MIN_ROW, MAX_ROW);
    this.scrollTo(this.scrollX, rows * this.rowHeight - anchorY);
  }

  /** Fit the key tracks from `lo` to `hi` (with a little margin) into the view, as Live's ruler double-click does. */
  fitPitches(lo: number, hi: number): void {
    if (this.height <= 0) return;
    this.rowF = clamp(this.height / (hi - lo + 1 + 4), MIN_ROW, MAX_ROW);
    this.centerOnPitch((lo + hi) / 2);
  }

  centerOnPitch(pitch: number): void {
    if (this.height <= 0) {
      this.pendingCenter = pitch; // not laid out yet; apply once we know our size
      return;
    }
    this.scrollTo(this.scrollX, (PITCH_COUNT - 1 - pitch + 0.5) * this.rowHeight - this.height / 2);
  }

  /** Resize the grid area, keeping the pitch at the vertical centre where it was. */
  setSize(width: number, height: number): void {
    const centreRow = (this.scrollY + this.height / 2) / this.rowHeight;
    const hadSize = this.height > 0;
    this.width = Math.max(0, width);
    this.height = Math.max(0, height);
    if (this.height <= 0) return;
    if (this.pendingCenter !== null) {
      const p = this.pendingCenter;
      this.pendingCenter = null;
      this.centerOnPitch(p);
    } else if (hadSize) {
      this.scrollTo(this.scrollX, centreRow * this.rowHeight - this.height / 2);
    } else {
      this.scrollBy(0, 0);
    }
  }
}
