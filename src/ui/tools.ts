// Note tools in the top bar: Legato and Humanize (with its amount popover).
import * as cmd from '../editing/commands';
import type { HumanizeOptions } from '../editing/transforms';
import type { Store } from '../state/store';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const STORAGE = 'piano:humanize';

export function mountTools(store: Store): void {
  $('btn-legato').addEventListener('click', () => cmd.legatoNotes(store));

  const pop = $('humanize-pop');
  const timing = $<HTMLInputElement>('hum-timing');
  const velocity = $<HTMLInputElement>('hum-velocity');
  const timingOut = $<HTMLOutputElement>('hum-timing-out');
  const velocityOut = $<HTMLOutputElement>('hum-velocity-out');

  const opts: HumanizeOptions = { timingMs: 15, velocity: 0, ...load() };
  timing.value = String(opts.timingMs);
  velocity.value = String(opts.velocity);
  const sync = () => {
    opts.timingMs = Number(timing.value);
    opts.velocity = Number(velocity.value);
    timingOut.textContent = `±${opts.timingMs} ms`;
    velocityOut.textContent = `±${opts.velocity}`;
    try {
      localStorage.setItem(STORAGE, JSON.stringify(opts));
    } catch {
      // only a convenience
    }
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
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') pop.hidden = true;
  });
  // Sliders shouldn't keep keyboard focus (Space must stay play/pause).
  for (const el of [timing, velocity]) el.addEventListener('change', () => el.blur());
}

function load(): Partial<HumanizeOptions> {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE) ?? '{}');
    return typeof v === 'object' && v ? v : {};
  } catch {
    return {};
  }
}
