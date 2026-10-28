// Palette sampled from Ableton Live's MIDI editor (default mid-grey theme).
export const C = {
  bg: '#4a5154', // outside the pitch range
  rowWhite: '#737c80',
  rowBlack: '#5e6569',
  rowLine: 'rgba(0,0,0,0.2)', // E|F boundary
  octaveLine: 'rgba(0,0,0,0.3)', // B|C boundary
  rowHover: 'rgba(255,255,255,0.06)',
  lineSub: 'rgba(0,0,0,0.1)',
  lineBeat: 'rgba(0,0,0,0.2)',
  lineBar: 'rgba(0,0,0,0.42)',

  noteBorder: '#14465d',
  noteSelectedOutline: '#a9d8ea',
  noteSelectedInner: '#0a5778',
  noteSelected: '#00a0d8',
  noteLabel: '#05324a',
  ghost: 'rgba(0,151,205,0.4)',
  marqueeFill: 'rgba(255,255,255,0.12)',
  marqueeStroke: 'rgba(255,255,255,0.85)',

  playhead: 'rgba(255,255,255,0.95)',
  insertMarker: 'rgba(255,255,255,0.55)',

  ruler: '#596164',
  scrub: '#4d5658',
  rulerText: '#e1e6e8',
  rulerTextDim: '#b0b8bb',
  rulerTick: 'rgba(0,0,0,0.42)',
  divider: '#353c3f',

  labelColumn: '#4d5658',
  label: '#c9d2d5',
  labelHover: '#ffffff',
  labelDivider: '#464d50',
  keysBorder: '#3f4448',
  keyWhite: '#e0e2e6',
  keyWhiteHover: '#f2f3f5',
  keyWhiteLine: '#a3a8ab',
  keyBlack: '#2d3437',
  keyBlackHover: '#454d51',
  keyActive: '#4fc0ea',
  keyActiveBlack: '#0084b5',
  keyboardRange: '#ffa21c',

  hint: 'rgba(20,24,26,0.5)',

  loopLane: '#454d50',
  loopOn: '#ffa21c',
  loopOnEdge: '#ffd08a',
  loopOff: '#7b8487',
  loopOffEdge: '#a3abae',
  outsideLoop: 'rgba(20,24,26,0.28)',
  loopLine: 'rgba(255,162,28,0.55)',
};

export const FONT = '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", system-ui, sans-serif';

/** Live shades notes by velocity: soft notes are paler, loud notes are deep blue. */
export function noteFill(velocity: number, hovered: boolean): string {
  const v = velocity / 127;
  const l = 62 - v * 22 + (hovered ? 6 : 0);
  return `hsl(196 ${35 + v * 65}% ${l}%)`;
}
