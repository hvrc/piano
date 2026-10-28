// Canvas palettes. Each theme gives every colour the renderer uses; switching theme swaps them
// in place (C is read on every frame), so nothing else has to know which theme is on.
//
// Paper: a player-piano roll on warm paper. Black ink for everything structural, with a few light
// inks here and there — teal (the roll's expression line), red pen (the playhead), highlighter
// yellow (hover), and a soft green (computer keyboard).
// Espresso: after Streamcell's theme — a warm brown-black room, cream ink, latte notes, steel-blue
// selection and loop, a honey playhead.

export type ThemeName = 'paper' | 'espresso';
export const THEMES: ThemeName[] = ['paper', 'espresso'];
export const THEME_LABELS: Record<ThemeName, string> = { paper: 'Paper', espresso: 'Espresso' };

import { hexToRgb } from '../model/colors';

const PAPER_INK = '35, 32, 27'; // rgb
const CREAM_INK = '237, 231, 223';
const inkOf = (rgb: string) => (a: number) => `rgba(${rgb}, ${a})`;

const PAPER = '#f4efe2';
const TEAL = '#4b9a95';
const RED_PEN = '#c8412f';
const HIGHLIGHT = '#f3e48c';
const GREEN = '#9cc46a';

function paperPalette() {
  const ink = inkOf(PAPER_INK);
  return {
    bg: '#ebe4d2', // outside the pitch range
    rowWhite: PAPER,
    rowBlack: '#ece5d3',
    rowLine: ink(0.06), // E|F boundary
    octaveLine: ink(0.18), // B|C boundary
    rowHover: 'rgba(243, 228, 140, 0.35)',
    lineSub: ink(0.07),
    lineBeat: ink(0.15),
    lineBar: ink(0.32),

    noteInk: ink(1),
    noteSelected: TEAL,
    noteSelectedHover: '#3d8580',
    noteSelectedOutline: '#2f6f6b',
    noteBorder: ink(1),
    noteLabel: PAPER,
    ghost: 'rgba(75, 154, 149, 0.9)',
    marqueeFill: 'rgba(75, 154, 149, 0.08)',
    marqueeStroke: ink(0.8),

    playhead: RED_PEN,
    insertMarker: 'rgba(200, 65, 47, 0.55)',

    ruler: '#f0eadb',
    scrub: PAPER,
    rulerText: ink(0.9),
    rulerTextDim: ink(0.45),
    rulerTick: ink(0.3),
    divider: ink(0.16), // soft hairlines between bands (matches --hairline in CSS)

    labelColumn: '#efe8d7', // the velocity lane's left column
    label: ink(0.75),
    labelHover: ink(1),
    keyNameOnDark: PAPER,
    keysBorder: ink(0.16),
    keyWhite: '#fbf8ef',
    keyWhiteHover: HIGHLIGHT,
    keyWhiteLine: ink(0.55),
    keyBlack: ink(1),
    keyBlackHover: '#5a554b',
    keyActive: TEAL,
    keyActiveBlack: '#2f6f6b',
    keyboardRange: GREEN,

    hint: ink(0.4),

    velLane: '#f0eadb',
    velGuide: ink(0.09),
    velLabel: ink(0.6),
    velValue: ink(1),

    loopLane: '#ebe4d2',
    loopOn: TEAL,
    loopOnEdge: TEAL,
    loopOff: ink(0.35),
    loopOffEdge: ink(0.35),
    outsideLoop: 'rgba(120, 104, 70, 0.10)',
    loopLine: 'rgba(75, 154, 149, 0.8)',
      keyNameOnLight: ink(0.75),
      noteRgb: PAPER_INK,
      noteAlpha: [0.3, 0.7] as [number, number],
      grainInk: PAPER_INK,
  };
}

function espressoPalette(): Palette {
  const ink = inkOf(CREAM_INK);
  const STEEL = '#6eaecd';
  const HONEY = '#e3b667';
  const ROOM = '#191613';
  return {
    bg: '#15120f',
    rowWhite: '#2a2520',
    rowBlack: '#221e1a',
    rowLine: ink(0.035),
    octaveLine: ink(0.1),
    rowHover: 'rgba(198, 164, 131, 0.14)',
    lineSub: ink(0.04),
    lineBeat: ink(0.08),
    lineBar: ink(0.16),

    noteInk: ink(1),
    noteSelected: STEEL,
    noteSelectedHover: '#86bcd6',
    noteSelectedOutline: '#a6d1e6',
    noteBorder: ink(1),
    noteLabel: ROOM,
    ghost: 'rgba(110, 174, 205, 0.9)',
    marqueeFill: 'rgba(110, 174, 205, 0.1)',
    marqueeStroke: ink(0.7),

    playhead: HONEY,
    insertMarker: 'rgba(227, 182, 103, 0.55)',

    ruler: '#211d19',
    scrub: '#25211c',
    rulerText: ink(0.9),
    rulerTextDim: ink(0.45),
    rulerTick: ink(0.24),
    divider: ink(0.12),

    labelColumn: '#211d19',
    label: ink(0.7),
    labelHover: ink(1),
    keyNameOnDark: '#ede7df',
    keyNameOnLight: 'rgba(25, 22, 19, 0.75)',
    keysBorder: ink(0.12),
    keyWhite: '#d8cdbf',
    keyWhiteHover: '#c6a483',
    keyWhiteLine: 'rgba(25, 22, 19, 0.35)',
    keyBlack: '#15120f',
    keyBlackHover: '#3b3027',
    keyActive: STEEL,
    keyActiveBlack: '#3f7f9c',
    keyboardRange: HONEY,

    hint: ink(0.35),

    velLane: '#211d19',
    velGuide: ink(0.06),
    velLabel: ink(0.55),
    velValue: ink(1),

    loopLane: '#1b1814',
    loopOn: STEEL,
    loopOnEdge: STEEL,
    loopOff: ink(0.3),
    loopOffEdge: ink(0.3),
    outsideLoop: 'rgba(0, 0, 0, 0.28)',
    loopLine: 'rgba(110, 174, 205, 0.7)',

    noteRgb: '198, 164, 131', // latte
    noteAlpha: [0.35, 0.65],
    grainInk: CREAM_INK,
  };
}

type Palette = ReturnType<typeof paperPalette>;

const PALETTES: Record<ThemeName, () => Palette> = { paper: paperPalette, espresso: espressoPalette };

/** The live palette the renderer reads. */
export const C: Palette = paperPalette();

let fills: string[][] = [];

/** Swap the canvas palette (and everything derived from it) to `name`. */
export function setCanvasTheme(name: ThemeName): void {
  Object.assign(C, PALETTES[name]());
  const [base, range] = C.noteAlpha;
  const note = inkOf(C.noteRgb);
  // Precomputed per velocity, so drawing a frame doesn't build colour strings per note.
  fills = [false, true].map((hovered) =>
    Array.from({ length: 128 }, (_, v) => note(Math.min(1, base + range * (v / 127) + (hovered ? 0.15 : 0)))),
  );
}
setCanvasTheme('paper');

export const FONT = '"Bungee Hairline", ui-monospace, "SF Mono", Menlo, monospace';
/** The handwriting face (Ballet) for titles and labels. */
export const SERIF = '"Ballet", "Iowan Old Style", Georgia, cursive';

/** Notes are ink slots punched in the roll: softer notes are fainter ink. */
export function noteFill(velocity: number, hovered: boolean, color?: string | null): string {
  const v = Math.max(0, Math.min(127, Math.round(velocity)));
  return (color ? colorFills(color) : fills)[hovered ? 1 : 0][v];
}

// Per-colour velocity ramps for coloured notes, built on first use and kept.
const colorCache = new Map<string, string[][]>();
function colorFills(hex: string): string[][] {
  let f = colorCache.get(hex);
  if (!f) {
    const c = inkOf(hexToRgb(hex));
    f = [false, true].map((hovered) =>
      Array.from({ length: 128 }, (_, v) => c(Math.min(1, 0.4 + 0.6 * (v / 127) + (hovered ? 0.15 : 0)))),
    );
    colorCache.set(hex, f);
  }
  return f;
}

/** Ink that reads on top of a note colour: dark on light colours, light on dark ones. */
export function labelOn(hex: string | null | undefined): string {
  if (!hex) return C.noteLabel;
  const n = parseInt(hex.slice(1), 16);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 140 ? 'rgba(25, 22, 19, 0.85)' : 'rgba(250, 247, 238, 0.92)';
}

/** A small tile of paper grain (ink specks and faint fibres), generated once. */
export function paperGrain(): HTMLCanvasElement {
  const ink = inkOf(C.grainInk);
  const size = 180;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = ink(0.018 + rnd() * 0.035);
    g.fillRect(rnd() * size, rnd() * size, rnd() < 0.85 ? 1 : 2, 1);
  }
  g.strokeStyle = ink(0.025);
  g.lineWidth = 0.6;
  for (let i = 0; i < 14; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + rnd() * 16 - 8, y + rnd() * 10 - 5, x + rnd() * 28 - 14, y + rnd() * 6 - 3);
    g.stroke();
  }
  return c;
}
