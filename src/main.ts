// Wires the modules together and runs the frame loop.
import './styles.css';
import { getAudioContext } from './audio/context';
import { createMasterBus } from './audio/output';
import { Piano } from './audio/piano';
import { Editor } from './editing/editor';
import { installShortcuts } from './editing/shortcuts';
import { ComputerKeyboard } from './input/computerKeyboard';
import { Session } from './library/session';
import { notesEnd } from './model/note';
import { PlayheadFollow } from './playback/follow';
import { Transport } from './playback/transport';
import { Layout } from './render/layout';
import { createOverlay } from './render/overlay';
import { Renderer } from './render/renderer';
import { Store } from './state/store';
import { BEATS_PER_BAR } from './timeline/grid';
import { Viewport } from './timeline/viewport';
import { $ } from './ui/dom';
import { mountFileBar } from './ui/fileBar';
import { mountSidebar } from './ui/sidebar';
import { mountThemeToggle } from './ui/themeToggle';
import { mountTools } from './ui/tools';
import { mountTransportBar } from './ui/transportBar';
import { storageGet, storageSet } from './util/storage';

const MIN_BARS = 32;
const TAIL_BARS = 16; // empty room to keep composing past the last note
const DEFAULT_CENTRE_PITCH = 66; // middle C (C3) a little below centre

const canvas = $<HTMLCanvasElement>('roll-canvas');
const helpPanel = $('help');

// --- core -------------------------------------------------------------------

const store = new Store();
const vp = new Viewport();
const layout = new Layout();
const overlay = createOverlay();

const ctx = getAudioContext();
const piano = new Piano(ctx, createMasterBus(ctx));
const transport = new Transport(store, piano);
const follow = new PlayheadFollow(store, vp);

let dirty = true;
const invalidate = () => (dirty = true);

const renderer = new Renderer(canvas, store, vp, layout, overlay, () => transport.currentBeat());
const editor = new Editor(canvas, store, vp, layout, overlay, piano, transport, invalidate);
const keyboard = new ComputerKeyboard(store, piano, (held) => {
  overlay.heldKeys = held;
  invalidate();
});

// Repaint (and re-check what's under the mouse) whenever the view or the data changes.
vp.onChange = () => {
  editor.refreshHover();
  invalidate();
};
store.subscribe((kind) => {
  // The playhead moving doesn't change what's under a still mouse.
  if (kind !== 'position' && kind !== 'playing') editor.refreshHover();
  invalidate();
});
transport.onJump = (beat) => follow.reveal(beat);

/** After opening a track: back to the start, centred on its notes. */
function showDocument(): void {
  const pitches = store.notes.map((n) => n.pitch).sort((a, b) => a - b);
  vp.scrollToStart();
  vp.centerOnPitch(pitches.length ? pitches[Math.floor(pitches.length / 2)] : DEFAULT_CENTRE_PITCH);
  follow.reveal();
}

const session = new Session(store, transport, showDocument);

// --- UI -----------------------------------------------------------------------

const toggleHelp = (show?: boolean) => {
  helpPanel.hidden = show === undefined ? !helpPanel.hidden : !show;
};
helpPanel.addEventListener('click', () => toggleHelp(false));

function toggleSidebar(): void {
  const hidden = document.body.classList.toggle('sidebar-hidden');
  storageSet('piano:sidebar', hidden ? 'hidden' : 'shown');
}
if (storageGet('piano:sidebar') === 'hidden') document.body.classList.add('sidebar-hidden');

const bar = mountTransportBar(store, transport, { onHelp: () => toggleHelp(), onKeys: () => keyboard.toggle() });
const fileBar = mountFileBar(session, { onToggleSidebar: toggleSidebar });
mountSidebar(session);
const closePopovers = mountTools(store);
mountThemeToggle(() => {
  renderer.retheme();
  invalidate();
});
installShortcuts({
  store,
  transport,
  vp,
  toggleHelp,
  closePopovers,
  keyboard,
  file: { save: (asCopy) => void session.save(asCopy), open: fileBar.openFilePicker },
});

// Reloading or closing with unsaved work asks first.
window.addEventListener('beforeunload', (e) => {
  if (session.dirty) e.preventDefault();
});

bar.setStatus('loading');
piano.load(`${import.meta.env.BASE_URL}samples/salamander/`).then((s) => bar.setStatus(s));
void session.init();

// --- layout & frame loop -----------------------------------------------------

new ResizeObserver(() => {
  renderer.resize();
  invalidate();
}).observe(canvas.parentElement!);
renderer.resize();
vp.centerOnPitch(DEFAULT_CENTRE_PITCH);
// Canvas text uses the web fonts; redraw once they arrive.
void document.fonts?.ready.then(() => {
  renderer.fontsLoaded();
  invalidate();
});

// Scrollable length: past the last note (and the playhead) with room to keep composing.
let lastNoteEnd = 0;
store.subscribe((kind) => {
  if (kind === 'notes') lastNoteEnd = notesEnd(store.notes);
});

function frame(): void {
  if (store.playing) {
    const beat = transport.currentBeat();
    store.setPosition(beat);
    follow.tick(beat);
  }
  const beats = Math.max(MIN_BARS * BEATS_PER_BAR, lastNoteEnd, store.position) + TAIL_BARS * BEATS_PER_BAR;
  vp.contentBeats = Math.ceil(beats / BEATS_PER_BAR) * BEATS_PER_BAR;
  editor.autoscroll();
  if (dirty) {
    renderer.render();
    dirty = false;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

if (import.meta.env.DEV) {
  Object.assign(window, { __piano: { store, vp, transport, piano, overlay, session, keyboard, layout } });
}
