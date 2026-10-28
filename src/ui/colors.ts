// Note colour pickers: the top-bar popover colours the selected notes (saved with the track);
// the settings swatches set the default colour for uncoloured notes (remembered in this browser).
import * as cmd from '../editing/commands';
import { NOTE_SWATCHES } from '../model/colors';
import { prefs } from '../state/prefs';
import type { Store } from '../state/store';
import { $ } from './dom';

function swatch(label: string, hex: string | null, onPick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'swatch' + (hex ? '' : ' none');
  b.title = label;
  b.setAttribute('aria-label', label);
  if (hex) b.style.setProperty('--swatch', hex);
  else b.textContent = '∅';
  b.dataset.hex = hex ?? '';
  b.addEventListener('click', onPick);
  return b;
}

/** Returns a function that closes the colour popover. */
export function mountColors(store: Store): () => void {
  // Selection popover
  const pop = $('color-pop');
  const hint = $('color-hint');
  const box = $('color-swatches');
  box.append(
    swatch('Default colour', null, () => cmd.colorSelected(store, null)),
    ...NOTE_SWATCHES.map((s) => swatch(s.name, s.hex, () => cmd.colorSelected(store, s.hex))),
  );
  const syncPop = () => {
    const n = store.selection.size;
    hint.textContent = n ? `Colour ${n} selected note${n === 1 ? '' : 's'}.` : 'Select notes first, then pick a colour.';
    box.classList.toggle('disabled', n === 0);
  };
  $('btn-color').addEventListener('click', () => {
    pop.hidden = !pop.hidden;
    syncPop();
  });
  store.subscribe((k) => {
    if (k === 'selection' || k === 'notes') syncPop();
  });
  document.addEventListener('pointerdown', (e) => {
    if (!pop.hidden && !(e.target as Element).closest('.pop-wrap')) pop.hidden = true;
  });

  // Default colour (settings)
  const defaults = $('default-swatches');
  const pickDefault = (hex: string | null) => prefs.set({ noteColor: hex });
  defaults.append(
    swatch('Theme colour', null, () => pickDefault(null)),
    ...NOTE_SWATCHES.map((s) => swatch(s.name, s.hex, () => pickDefault(s.hex))),
  );
  const syncDefaults = () => {
    for (const b of defaults.querySelectorAll<HTMLButtonElement>('.swatch')) {
      b.classList.toggle('on', (b.dataset.hex || null) === prefs.value.noteColor);
    }
  };
  prefs.subscribe(syncDefaults);
  syncDefaults();

  return () => (pop.hidden = true);
}
