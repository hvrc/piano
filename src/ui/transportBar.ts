// The compact top bar: transport, tempo, position, and grid/draw settings.
import type { PianoStatus } from '../audio/piano';
import type { Transport } from '../playback/transport';
import type { Store } from '../state/store';
import { formatPosition, GRID_OPTIONS } from '../timeline/grid';
import { pitchName } from '../music/pitch';

const MIN_BPM = 20;
const MAX_BPM = 400;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface TransportBar {
  setStatus(status: PianoStatus): void;
}

export function mountTransportBar(
  store: Store,
  transport: Transport,
  opts: { onHelp: () => void; onPlay: () => void; onReturn: () => void; onKeys: () => void },
): TransportBar {
  const play = $<HTMLButtonElement>('btn-play');
  const toStart = $<HTMLButtonElement>('btn-start');
  const pos = $<HTMLOutputElement>('pos');
  const bpm = $<HTMLInputElement>('bpm');
  const draw = $<HTMLButtonElement>('btn-draw');
  const grid = $<HTMLSelectElement>('grid');
  const triplet = $<HTMLButtonElement>('btn-triplet');
  const snap = $<HTMLButtonElement>('btn-snap');
  const status = $<HTMLSpanElement>('status');
  const help = $<HTMLButtonElement>('btn-help');
  const keys = $<HTMLButtonElement>('btn-keys');
  const keysInfo = $<HTMLSpanElement>('keys-info');

  // Buttons never take focus, so Space always means play/pause.
  for (const b of document.querySelectorAll<HTMLButtonElement>('header button')) {
    b.addEventListener('mousedown', (e) => e.preventDefault());
  }

  play.addEventListener('click', () => {
    transport.toggle();
    if (store.playing) opts.onPlay();
  });
  toStart.addEventListener('click', () => {
    transport.seek(0);
    opts.onReturn();
  });
  draw.addEventListener('click', () => store.setDrawMode(!store.drawMode));
  triplet.addEventListener('click', () => store.setGrid({ triplet: !store.grid.triplet }));
  snap.addEventListener('click', () => store.setGrid({ snap: !store.grid.snap }));
  help.addEventListener('click', opts.onHelp);
  keys.addEventListener('click', opts.onKeys);

  for (const o of GRID_OPTIONS) grid.add(new Option(o.label, String(o.value)));
  grid.addEventListener('change', () => {
    store.setGrid({ division: Number(grid.value) });
    grid.blur();
  });

  // Tempo box, Live-style: drag vertically to change, click to type.
  const commitBpm = (v: number) => {
    if (!Number.isFinite(v)) return;
    const clamped = Math.round(Math.max(MIN_BPM, Math.min(MAX_BPM, v)) * 100) / 100;
    if (clamped !== store.bpm) transport.setBpm(clamped);
    bpm.value = fmtBpm(store.bpm);
  };
  let dragY: number | null = null;
  let dragStart = 0;
  let moved = false;
  bpm.addEventListener('pointerdown', (e) => {
    if (document.activeElement === bpm) return;
    e.preventDefault();
    bpm.setPointerCapture(e.pointerId);
    dragY = e.clientY;
    dragStart = store.bpm;
    moved = false;
  });
  bpm.addEventListener('pointermove', (e) => {
    if (dragY === null) return;
    const dy = dragY - e.clientY;
    if (Math.abs(dy) > 2) moved = true;
    if (moved) commitBpm(dragStart + (e.shiftKey ? dy / 10 : Math.round(dy / 2)));
  });
  bpm.addEventListener('pointerup', () => {
    if (dragY === null) return;
    dragY = null;
    if (!moved) {
      bpm.focus();
      bpm.select();
    }
  });
  bpm.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') bpm.blur();
    else if (e.key === 'Escape') {
      bpm.value = fmtBpm(store.bpm);
      bpm.blur();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      commitBpm(store.bpm + (e.key === 'ArrowUp' ? 1 : -1));
      bpm.select();
    }
  });
  bpm.addEventListener('blur', () => commitBpm(parseFloat(bpm.value)));

  const sync = () => {
    play.classList.toggle('on', store.playing);
    play.setAttribute('aria-label', store.playing ? 'Pause' : 'Play');
    play.title = store.playing ? 'Pause (Space)' : 'Play (Space)';
    const text = formatPosition(store.position);
    if (pos.textContent !== text) pos.textContent = text;
    if (document.activeElement !== bpm) bpm.value = fmtBpm(store.bpm);
    draw.classList.toggle('on', store.drawMode);
    grid.value = String(store.grid.division);
    triplet.classList.toggle('on', store.grid.triplet);
    snap.classList.toggle('on', store.grid.snap);
    const kb = store.keyboard;
    keys.classList.toggle('on', kb.enabled);
    keysInfo.textContent = kb.enabled ? `${pitchName(kb.base)} · ${kb.velocity}` : '';
    keys.title = kb.enabled
      ? `Computer keyboard on (M): A–' play ${pitchName(kb.base)}–${pitchName(Math.min(127, kb.base + 17))}, Z/X octave, C/V velocity`
      : 'Play notes with the computer keyboard (M)';
  };
  store.subscribe(sync);
  sync();

  return {
    setStatus(s) {
      status.textContent = s === 'loading' ? 'Loading piano…' : s === 'sampled' ? 'Grand piano' : 'Synth piano';
      status.title =
        s === 'sampled'
          ? 'Salamander Grand Piano V3 by Alexander Holm (CC-BY 3.0)'
          : s === 'synth'
            ? 'Piano samples failed to load; using the built-in synth'
            : 'Samples loading; the synth plays meanwhile';
      status.dataset.state = s;
    },
  };
}

function fmtBpm(v: number): string {
  return v.toFixed(2);
}
