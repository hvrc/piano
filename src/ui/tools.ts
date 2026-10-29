// Note tools in the top bar: Legato, Reverse, Humanize and Quantize (each with an amount popover).
import * as cmd from '../editing/commands';
import type { HumanizeOptions, QuantizeOptions } from '../editing/transforms';
import type { Store } from '../state/store';

import { storageGetJson, storageSet } from '../util/storage';
import { $ } from './dom';

const HUMANIZE_STORAGE = 'piano:humanize';
const QUANTIZE_STORAGE = 'piano:quantize';

/** Live's Quantize To choices, in beats; 0 follows the current grid. */
const QUANTIZE_TO: { label: string; value: number }[] = [
  { label: 'Current grid', value: 0 },
  { label: '1/4', value: 1 },
  { label: '1/8', value: 0.5 },
  { label: '1/8 triplet', value: 1 / 3 },
  { label: '1/16', value: 0.25 },
  { label: '1/16 triplet', value: 1 / 6 },
  { label: '1/32', value: 0.125 },
];

interface QuantizeSettings {
  to: number; // beats, 0 = current grid
  amount: number; // percent
  ends: boolean;
}

export interface Tools {
  /** Close the popovers (Escape is handled by the shortcuts). */
  close: () => void;
  /** ⌘U: quantize with the saved settings. */
  quantize: () => void;
  /** ⇧⌘U: show the Quantize settings. */
  openQuantize: () => void;
}

export function mountTools(store: Store): Tools {
  $('btn-legato').addEventListener('click', () => cmd.legatoNotes(store));
  $('btn-reverse').addEventListener('click', () => cmd.reverseNotes(store));

  // --- Humanize
  const humPop = $('humanize-pop');
  const timing = $<HTMLInputElement>('hum-timing');
  const velocity = $<HTMLInputElement>('hum-velocity');
  const timingOut = $<HTMLOutputElement>('hum-timing-out');
  const velocityOut = $<HTMLOutputElement>('hum-velocity-out');

  const hum: HumanizeOptions = { timingMs: 15, velocity: 0, ...storageGetJson<HumanizeOptions>(HUMANIZE_STORAGE) };
  timing.value = String(hum.timingMs);
  velocity.value = String(hum.velocity);
  const syncHumanize = () => {
    hum.timingMs = Number(timing.value);
    hum.velocity = Number(velocity.value);
    timingOut.textContent = `±${hum.timingMs} ms`;
    velocityOut.textContent = `±${hum.velocity}`;
    storageSet(HUMANIZE_STORAGE, JSON.stringify(hum));
  };
  timing.addEventListener('input', syncHumanize);
  velocity.addEventListener('input', syncHumanize);
  syncHumanize();
  $('hum-apply').addEventListener('click', () => cmd.humanizeNotes(store, hum));

  // --- Quantize
  const qzPop = $('quantize-pop');
  const qzTo = $<HTMLSelectElement>('qz-to');
  const qzAmount = $<HTMLInputElement>('qz-amount');
  const qzAmountOut = $<HTMLOutputElement>('qz-amount-out');
  const qzEnds = $<HTMLInputElement>('qz-ends');

  const qz: QuantizeSettings = { to: 0, amount: 100, ends: false, ...storageGetJson<QuantizeSettings>(QUANTIZE_STORAGE) };
  for (const o of QUANTIZE_TO) qzTo.add(new Option(o.label, String(o.value)));
  if (!QUANTIZE_TO.some((o) => String(o.value) === String(qz.to))) qz.to = 0;
  qzTo.value = String(qz.to);
  qzAmount.value = String(qz.amount);
  qzEnds.checked = qz.ends;
  const syncQuantize = () => {
    qz.to = Number(qzTo.value);
    qz.amount = Number(qzAmount.value);
    qz.ends = qzEnds.checked;
    qzAmountOut.textContent = `${qz.amount}%`;
    storageSet(QUANTIZE_STORAGE, JSON.stringify(qz));
  };
  for (const el of [qzTo, qzAmount, qzEnds]) el.addEventListener('input', syncQuantize);
  syncQuantize();
  const quantize = () => {
    const opts: QuantizeOptions = { amount: qz.amount / 100, ends: qz.ends };
    cmd.quantizeNotes(store, qz.to, opts);
  };
  $('qz-apply').addEventListener('click', quantize);

  // --- Popovers: one open at a time, closed by clicking elsewhere
  const pops: [HTMLElement, HTMLElement][] = [
    [$('btn-humanize'), humPop],
    [$('btn-quantize'), qzPop],
  ];
  const show = (pop: HTMLElement, open: boolean) => {
    for (const [, p] of pops) p.hidden = p !== pop || !open;
  };
  for (const [btn, pop] of pops) {
    btn.addEventListener('click', () => show(pop, !!pop.hidden));
    for (const el of pop.querySelectorAll('button, input, select')) el.addEventListener('mousedown', (e) => e.stopPropagation());
  }
  document.addEventListener('pointerdown', (e) => {
    if (!(e.target as Element).closest('.pop-wrap')) show(humPop, false);
  });
  // Controls shouldn't keep keyboard focus (Space must stay play/pause).
  for (const el of [timing, velocity, qzTo, qzAmount, qzEnds]) el.addEventListener('change', () => el.blur());

  return {
    close: () => show(humPop, false),
    quantize,
    openQuantize: () => show(qzPop, true),
  };
}
