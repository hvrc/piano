// Keyboard shortcuts, following Ableton Live where a direct equivalent exists.
import type { Store } from '../state/store';
import type { Transport } from '../playback/transport';
import type { Viewport } from '../timeline/viewport';
import { GRID_OPTIONS, gridStep, snapCeil, snapFloor, snapRound } from '../timeline/grid';
import { noteBounds, notesEnd } from '../model/note';
import * as cmd from './commands';
import type { ComputerKeyboard } from '../input/computerKeyboard';

export interface ShortcutContext {
  store: Store;
  transport: Transport;
  vp: Viewport;
  toggleHelp: (show?: boolean) => void;
  closePopovers: () => void;
  keyboard: ComputerKeyboard;
  actions: { record: () => void; metronome: () => void; falling: () => void };
  file: { save: (asCopy: boolean) => void; open: () => void };
}

export function installShortcuts(c: ShortcutContext): void {
  // (An open dialog captures keydown first and stops it, so nothing here fires behind it.)
  window.addEventListener('keydown', (e) => {
    // Save / open work everywhere, including while typing a track name.
    if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key.toLowerCase() === 's' || e.key.toLowerCase() === 'o')) {
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur?.();
      if (e.key.toLowerCase() === 's') c.file.save(e.shiftKey);
      else c.file.open();
      return;
    }
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (handle(c, e)) e.preventDefault();
  });
}

function handle(c: ShortcutContext, e: KeyboardEvent): boolean {
  const { store, transport, vp } = c;
  const mod = e.metaKey || e.ctrlKey;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const step = gridStep(store.grid);
  const hasSel = store.selection.size > 0;

  // Computer MIDI keyboard (M toggles, as in Live) takes its keys before anything else.
  if (!mod && !e.altKey && e.code === 'KeyM') {
    c.keyboard.toggle();
    return true;
  }
  if (c.keyboard.keyDown(e)) return true;

  if (mod) {
    switch (key) {
      case 'a': cmd.selectAll(store); return true;
      case 'd': cmd.duplicateSelected(store); return true;
      case 'c': cmd.copySelected(store); return true;
      case 'x': cmd.cutSelected(store); return true;
      case 'v': {
        const end = cmd.paste(store, store.position);
        if (end !== null && !store.playing) transport.seek(end);
        return true;
      }
      case 'z': if (e.shiftKey) store.redo(); else store.undo(); return true;
      case 'y': store.redo(); return true;
      case 'l':
        if (e.shiftKey) cmd.legatoNotes(store);
        else loopSelection(store);
        return true;
      case 'ArrowUp': cmd.changeVelocity(store, 10); return true;
      case 'ArrowDown': cmd.changeVelocity(store, -10); return true;
    }
  }

  // Grid: Cmd+1..4 as in Live (browsers may reserve Cmd+digits, so plain digits work too).
  if (!e.altKey && ['1', '2', '3', '4'].includes(e.key)) {
    const i = GRID_OPTIONS.findIndex((o) => o.value === store.grid.division);
    if (e.key === '1') store.setGrid({ division: GRID_OPTIONS[Math.min(GRID_OPTIONS.length - 1, i + 1)].value });
    if (e.key === '2') store.setGrid({ division: GRID_OPTIONS[Math.max(0, i - 1)].value });
    if (e.key === '3') store.setGrid({ triplet: !store.grid.triplet });
    if (e.key === '4') store.setGrid({ snap: !store.grid.snap });
    return true;
  }
  if (mod) return false;

  switch (key) {
    case ' ':
      if (e.shiftKey && !store.playing) transport.play();
      else transport.toggle();
      return true;
    case 'b': store.setDrawMode(!store.drawMode); return true;
    case 'l': store.setLoop({ enabled: !store.loop.enabled }); return true;
    case 'r':
    case 'F9': c.actions.record(); return true; // F9 is Live's record key
    case 'o': c.actions.metronome(); return true;
    case 'v': c.actions.falling(); return true;
    case 'Delete':
    case 'Backspace': cmd.deleteSelected(store); return true;
    case 'Escape':
      if (store.view === 'falling') store.setView('roll');
      store.setSelection([]);
      c.toggleHelp(false);
      c.closePopovers();
      return true;
    case '?': c.toggleHelp(); return true;
    case 'Home': transport.seek(0); return true;
    case 'End': {
      transport.seek(notesEnd(store.notes));
      return true;
    }
    case 'ArrowUp':
    case 'ArrowDown': {
      const dir = key === 'ArrowUp' ? 1 : -1;
      if (hasSel) cmd.transposeSelected(store, dir * (e.shiftKey ? 12 : 1));
      else vp.scrollBy(0, -dir * vp.rowHeight * (e.shiftKey ? 12 : 1));
      return true;
    }
    case 'ArrowLeft':
    case 'ArrowRight': {
      const dir = key === 'ArrowRight' ? 1 : -1;
      if (hasSel && e.shiftKey) cmd.resizeSelected(store, dir * step);
      else if (hasSel) cmd.moveSelected(store, dir * step);
      else {
        transport.seek(Math.max(0, snapRound(store.position, step) + dir * step));
      }
      return true;
    }
    case '+':
    case '=': vp.zoomX(1.25, vp.width / 2); return true;
    case '-':
    case '_': vp.zoomX(0.8, vp.width / 2); return true;
    case 'PageUp': vp.scrollBy(0, -vp.rowHeight * (e.shiftKey ? 1 : 12)); return true;
    case 'PageDown': vp.scrollBy(0, vp.rowHeight * (e.shiftKey ? 1 : 12)); return true;
  }
  return false;
}

/** ⌘L: loop the selected notes (rounded out to the grid) and switch the loop on, as in Live. */
function loopSelection(store: Store): void {
  const sel = store.selectedNotes();
  if (!sel.length) {
    store.setLoop({ enabled: !store.loop.enabled });
    return;
  }
  const step = gridStep(store.grid);
  const start = snapFloor(noteBounds(sel).start, step);
  const end = snapCeil(notesEnd(sel), step);
  store.setLoop({ start, end: Math.max(end, start + step), enabled: true });
}
