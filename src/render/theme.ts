// "Paper and pen": a player-piano roll on warm paper. Black ink for everything structural,
// with a few light inks here and there — teal (the roll's expression line), red pen (the
// playhead), highlighter yellow (hover), and a soft green (computer keyboard).
const INK = '35, 32, 27'; // rgb of the ink
const ink = (a: number) => `rgba(${INK}, ${a})`;

export const PAPER = '#f4efe2';
export const TEAL = '#4b9a95';
export const RED_PEN = '#c8412f';
export const HIGHLIGHT = '#f3e48c';
export const GREEN = '#9cc46a';

export const C = {
  page: PAPER, // the page around the canvas panels
  bg: '#ebe4d2', // outside the pitch range
  rowWhite: PAPER,
  rowBlack: '#ece5d3',
  rowLine: ink(0.1), // E|F boundary
  octaveLine: ink(0.32), // B|C boundary
  rowHover: 'rgba(243, 228, 140, 0.35)',
  lineSub: ink(0.12),
  lineBeat: ink(0.28),
  lineBar: ink(0.6),

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
  rulerTick: ink(0.5),
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
  velGuide: ink(0.16),
  velLabel: ink(0.6),
  velValue: ink(1),

  loopLane: '#ebe4d2',
  loopOn: TEAL,
  loopOnEdge: TEAL,
  loopOff: ink(0.35),
  loopOffEdge: ink(0.35),
  outsideLoop: 'rgba(120, 104, 70, 0.10)',
  loopLine: 'rgba(75, 154, 149, 0.8)',
};

export const FONT = '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace';
export const SERIF = '"Instrument Serif", "Iowan Old Style", Georgia, serif';

/** Notes are ink slots punched in the roll: softer notes are fainter ink. */
function fillFor(velocity: number, hovered: boolean): string {
  const v = velocity / 127;
  return ink(Math.min(1, 0.3 + 0.7 * v + (hovered ? 0.15 : 0)));
}

// Precomputed per velocity, so drawing a frame doesn't build colour strings per note.
const FILLS = [false, true].map((hovered) => Array.from({ length: 128 }, (_, v) => fillFor(v, hovered)));

export function noteFill(velocity: number, hovered: boolean): string {
  return FILLS[hovered ? 1 : 0][Math.max(0, Math.min(127, Math.round(velocity)))];
}

/** A small tile of paper grain (ink specks and faint fibres), generated once. */
export function paperGrain(): HTMLCanvasElement {
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
