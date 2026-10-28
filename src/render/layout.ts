// Fixed regions of the piano roll canvas.
export const LABEL_W = 34; // note-name column, left of the keys (as in Live)
export const KEYS_W = 66; // label column + key strip
export const RULER_H = 34; // total ruler height
export const SCRUB_H = 18; // upper ruler strip: bar numbers, click/drag to move the playhead

export type Region = 'grid' | 'ruler' | 'keys' | 'corner';

export function regionAt(x: number, y: number): Region {
  if (y < RULER_H) return x < KEYS_W ? 'corner' : 'ruler';
  return x < KEYS_W ? 'keys' : 'grid';
}
