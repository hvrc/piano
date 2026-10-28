// Musical grid: divisions, snapping and position formatting. Fixed 4/4.

export const BEATS_PER_BAR = 4;

export interface GridSettings {
  division: number; // grid step in beats before triplet adjustment
  triplet: boolean;
  snap: boolean;
}

export const GRID_OPTIONS: { label: string; value: number }[] = [
  { label: '1 Bar', value: 4 },
  { label: '1/2', value: 2 },
  { label: '1/4', value: 1 },
  { label: '1/8', value: 0.5 },
  { label: '1/16', value: 0.25 },
  { label: '1/32', value: 0.125 },
  { label: '1/64', value: 0.0625 },
];

export const EPS = 1e-6;

export function gridStep(g: GridSettings): number {
  return g.triplet ? (g.division * 2) / 3 : g.division;
}

export function snapFloor(beat: number, step: number): number {
  return Math.floor(beat / step + EPS) * step;
}

export function snapCeil(beat: number, step: number): number {
  return Math.ceil(beat / step - EPS) * step;
}

export function snapRound(beat: number, step: number): number {
  return Math.round(beat / step) * step;
}

export function isMultiple(beat: number, unit: number): boolean {
  const q = beat / unit;
  return Math.abs(q - Math.round(q)) < EPS;
}

/** Ableton-style bars.beats.sixteenths, 1-based. */
export function formatPosition(beat: number): string {
  const s = Math.floor(Math.max(0, beat) * 4 + EPS);
  const bar = Math.floor(s / 16) + 1;
  const b = Math.floor((s % 16) / 4) + 1;
  const six = (s % 4) + 1;
  return `${bar}.${b}.${six}`;
}
