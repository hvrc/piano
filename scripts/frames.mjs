// Generates the ornamental panel frame (public/frames/*.svg), one file per theme ink.
// The frame is a 9-slice for CSS border-image: 32px corner tiles, straight rules between them.
// A double rule — the outer one notched at each corner, the inner one ending in a small scroll —
// after Victorian book borders, kept sparse. Run: node scripts/frames.mjs
import { mkdirSync, writeFileSync } from 'node:fs';

const INKS = {
  paper: 'rgba(35,32,27,0.78)',
  espresso: 'rgba(237,231,223,0.55)',
};
// Cards float over the roll, so their frame also carries the paper, cut to the notched outline.
const PAPERS = { paper: '#f4efe2', espresso: '#191613' };

const S = 96; // whole tile; corners are 32 x 32
const O = 2; // outer rule inset (its corner notch has radius R, below)
const I = 6; // inner rule inset

// Top-left corner ornament; the other three corners mirror it.
const corner = `
  <path d="M13 ${O} A11 11 0 0 1 ${O} 13" />
  <path d="M25 ${I} C19 ${I} 15.5 8.6 15.5 12.2 C15.5 15.3 18.6 16.4 20.2 14.6 C21.4 13.2 20.4 11.4 18.8 11.8" />
  <path d="M${I} 25 C${I} 19 8.6 15.5 12.2 15.5 C15.3 15.5 16.4 18.6 14.6 20.2 C13.2 21.4 11.4 20.4 11.8 18.8" />
  <circle cx="12.4" cy="12.4" r="1.15" stroke="none" fill="INK" />`;

const rules = `
  <path d="M13 ${O} H${S - 13} M${O} 13 V${S - 13} M${S - 13} ${S - O} H13 M${S - O} ${S - 13} V13" stroke-width="1.1" />
  <path d="M25 ${I} H${S - 25} M${I} 25 V${S - 25} M${S - 25} ${S - I} H25 M${S - I} ${S - 25} V25" stroke-width="0.6" />`;

// The outer rule's outline (notched corners), traced clockwise.
const R = 11;
const outline = `M${O + R} ${O} H${S - O - R} A${R} ${R} 0 0 0 ${S - O} ${O + R} V${S - O - R} A${R} ${R} 0 0 0 ${S - O - R} ${S - O} H${O + R} A${R} ${R} 0 0 0 ${O} ${S - O - R} V${O + R} A${R} ${R} 0 0 0 ${O + R} ${O} Z`;

function svg(ink, paper) {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
${paper ? `<path d="${outline}" fill="${paper}" />\n` : ''}<defs><g id="c" fill="none" stroke="${ink}" stroke-width="0.9" stroke-linecap="round">${corner.replace('INK', ink)}
</g></defs>
<g fill="none" stroke="${ink}" stroke-linecap="round">${rules}
</g>
<use xlink:href="#c" />
<use xlink:href="#c" transform="translate(${S} 0) scale(-1 1)" />
<use xlink:href="#c" transform="translate(0 ${S}) scale(1 -1)" />
<use xlink:href="#c" transform="translate(${S} ${S}) scale(-1 -1)" />
</svg>
`;
}

mkdirSync('public/frames', { recursive: true });
for (const [theme, ink] of Object.entries(INKS)) {
  writeFileSync(`public/frames/${theme}.svg`, svg(ink));
  writeFileSync(`public/frames/${theme}-card.svg`, svg(ink, PAPERS[theme]));
}
console.log('wrote public/frames/{paper,espresso}{,-card}.svg');
