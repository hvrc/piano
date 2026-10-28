// Fixed regions of the piano roll canvas.
export const LABEL_W = 34; // note-name column, left of the keys (as in Live)
export const KEYS_W = 66; // label column + key strip
export const LOOP_H = 12; // top ruler lane: the loop brace
export const SCRUB_H = 18; // next strip: bar numbers, click/drag to move the playhead
export const BEAT_H = 16; // bottom strip: beat ticks, drag to zoom/scroll
export const RULER_H = LOOP_H + SCRUB_H + BEAT_H; // total ruler height

export const VEL_H = 76; // velocity lane under the notes, as in Live
const VEL_PAD_TOP = 9;
const VEL_PAD_BOTTOM = 6;

export type Region = 'grid' | 'ruler' | 'keys' | 'corner' | 'velocity';

/** `height` is the canvas's CSS height (the velocity lane sits at its bottom). */
export function regionAt(x: number, y: number, height: number): Region {
  if (y < RULER_H) return x < KEYS_W ? 'corner' : 'ruler';
  if (y >= height - VEL_H) return x < KEYS_W ? 'corner' : 'velocity';
  return x < KEYS_W ? 'keys' : 'grid';
}

/** y (canvas CSS px) of a velocity value's stem head inside the lane. */
export function velocityToY(v: number, height: number): number {
  const bottom = height - VEL_PAD_BOTTOM;
  return bottom - (v / 127) * (VEL_H - VEL_PAD_TOP - VEL_PAD_BOTTOM);
}

export function yToVelocity(y: number, height: number): number {
  const bottom = height - VEL_PAD_BOTTOM;
  const v = ((bottom - y) / (VEL_H - VEL_PAD_TOP - VEL_PAD_BOTTOM)) * 127;
  return Math.max(1, Math.min(127, Math.round(v)));
}
