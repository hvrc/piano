// Note tools in the top bar: Legato, Reverse and Humanize (with its amount popover).
import * as cmd from '../editing/commands';
import type { HumanizeOptions } from '../editing/transforms';
import type { Store } from '../state/store';

import { storageGetJson, storageSet } from '../util/storage';
import { $ } from './dom';

const STORAGE = 'piano:humanize';

/** Returns a function that closes the Humanize popover (Escape is handled by the shortcuts). */
export function mountTools(store: Store): () => void {
  $('btn-legato').addEventListener('click', () => cmd.legatoNotes(store));
  $('btn-reverse').addEventListener('click', () => cmd.reverseNotes(store));

  const pop = $('humanize-pop');
  const timing = $<HTMLInputElement>('hum-timing');
  const velocity = $<HTMLInputElement>('hum-velocity');
  const timingOut = $<HTMLOutputElement>('hum-timing-out');
  const velocityOut = $<HTMLOutputElement>('hum-velocity-out');

  const opts: HumanizeOptions = { timingMs: 15, velocity: 0, ...storageGetJson<HumanizeOptions>(STORAGE) };
  timing.value = String(opts.timingMs);
  velocity.value = String(opts.velocity);
  const sync = () => {
    opts.timingMs = Number(timing.value);
    opts.velocity = Number(velocity.value);
    timingOut.textContent = `±${opts.timingMs} ms`;
    velocityOut.textContent = `±${opts.velocity}`;
    storageSet(STORAGE, JSON.stringify(opts));
  };
  timing.addEventListener('input', sync);
  velocity.addEventListener('input', sync);
  sync();

  $('btn-humanize').addEventListener('click', () => (pop.hidden = !pop.hidden));
  $('hum-apply').addEventListener('click', () => cmd.humanizeNotes(store, opts));
  for (const el of pop.querySelectorAll('button, input')) el.addEventListener('mousedown', (e) => e.stopPropagation());
  document.addEventListener('pointerdown', (e) => {
    if (!pop.hidden && !(e.target as Element).closest('.pop-wrap')) pop.hidden = true;
  });
  // Sliders shouldn't keep keyboard focus (Space must stay play/pause).
  for (const el of [timing, velocity]) el.addEventListener('change', () => el.blur());
  return () => (pop.hidden = true);
}

