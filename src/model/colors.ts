// Note colours. Stored on notes as hex strings, so they look the same in every theme.
// Plain JS + types only (the server validates against NOTE_COLOR).

export const NOTE_COLOR = /^#[0-9a-fA-F]{6}$/;

/** The swatches offered in the colour picker and settings. */
export const NOTE_SWATCHES: { name: string; hex: string }[] = [
  { name: 'Ink', hex: '#3a352d' },
  { name: 'Latte', hex: '#c6a483' },
  { name: 'Steel', hex: '#6eaecd' },
  { name: 'Teal', hex: '#4b9a95' },
  { name: 'Sage', hex: '#8fb38a' },
  { name: 'Honey', hex: '#e3b667' },
  { name: 'Coral', hex: '#e08a5f' },
  { name: 'Rose', hex: '#d98b9b' },
  { name: 'Plum', hex: '#a58bc7' },
];

export function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}
