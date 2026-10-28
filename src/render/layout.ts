// Where everything sits on the piano-roll canvas. One Layout is shared by the renderer (to draw)
// and the editor (to hit-test), so pointer and drawing coordinates can't drift apart.
//
//   ┌ corner ┬ loop lane (loop brace) ─────────┐
//   │        ├ scrub strip (bar numbers)       │  RULER_H
//   │        ├ beat strip (ticks, drag = zoom) │
//   ├ keys   ┼ grid (notes) ───────────────────┤
//   ├ corner ┼ velocity lane ──────────────────┤  VEL_H
//   └────────┴─────────────────────────────────┘
//    KEYS_W = the piano keys (note names are written on them)
import { clampVelocity } from '../model/note';

export const KEYS_W = 52;
export const LOOP_H = 12;
export const SCRUB_H = 18;
export const BEAT_H = 16;
export const RULER_H = LOOP_H + SCRUB_H + BEAT_H;
export const VEL_H = 76;
const VEL_PAD_TOP = 9;
const VEL_PAD_BOTTOM = 6;

export type Region = 'loop' | 'scrub' | 'beat' | 'keys' | 'grid' | 'velocity' | 'corner';

export interface Point {
  x: number;
  y: number;
}

export class Layout {
  width = 0;
  height = 0;

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  /** Size of the note grid (the Viewport's area). */
  get gridWidth(): number {
    return Math.max(0, this.width - KEYS_W);
  }

  get gridHeight(): number {
    return Math.max(0, this.height - RULER_H - VEL_H);
  }

  get velocityTop(): number {
    return this.height - VEL_H;
  }

  regionAt({ x, y }: Point): Region {
    if (y < RULER_H) return x < KEYS_W ? 'corner' : y < LOOP_H ? 'loop' : y < LOOP_H + SCRUB_H ? 'scrub' : 'beat';
    if (y >= this.velocityTop) return x < KEYS_W ? 'corner' : 'velocity';
    return x < KEYS_W ? 'keys' : 'grid';
  }

  /** Canvas point → coordinates inside the grid area. */
  toGrid({ x, y }: Point): Point {
    return { x: x - KEYS_W, y: y - RULER_H };
  }

  /** y of a velocity value's stem head in the velocity lane. */
  velocityToY(v: number): number {
    return this.height - VEL_PAD_BOTTOM - (v / 127) * (VEL_H - VEL_PAD_TOP - VEL_PAD_BOTTOM);
  }

  yToVelocity(y: number): number {
    return clampVelocity(((this.height - VEL_PAD_BOTTOM - y) / (VEL_H - VEL_PAD_TOP - VEL_PAD_BOTTOM)) * 127);
  }
}
