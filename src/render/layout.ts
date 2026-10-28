// Fixed regions of the piano roll canvas.
export const LABEL_W = 34; // note-name column, left of the keys (as in Live)
export const KEYS_W = 66; // label column + key strip
export const LOOP_H = 12; // top ruler lane: the loop brace
export const SCRUB_H = 18; // next strip: bar numbers, click/drag to move the playhead
export const BEAT_H = 16; // bottom strip: beat ticks, drag to zoom/scroll
export const RULER_H = LOOP_H + SCRUB_H + BEAT_H; // total ruler height

export type Region = 'grid' | 'ruler' | 'keys' | 'corner';

export function regionAt(x: number, y: number): Region {
  if (y < RULER_H) return x < KEYS_W ? 'corner' : 'ruler';
  return x < KEYS_W ? 'keys' : 'grid';
}
