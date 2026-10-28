// Wires the modules together and runs the frame loop.
import './styles.css';
import { getAudioContext } from './audio/context';
import { createMasterBus } from './audio/output';
import { Piano } from './audio/piano';
import { Editor } from './editing/editor';
import { installShortcuts } from './editing/shortcuts';
import { noteEnd } from './model/note';
import { Transport } from './playback/transport';
import { createOverlay } from './render/overlay';
import { Renderer } from './render/renderer';
import { Store } from './state/store';
import { BEATS_PER_BAR } from './timeline/grid';
import { Viewport } from './timeline/viewport';
import { mountTransportBar } from './ui/transportBar';
import { ComputerKeyboard } from './input/computerKeyboard';
import { Session } from './library/session';
import { mountFileBar } from './ui/fileBar';
import { mountSidebar } from './ui/sidebar';

const MIN_BARS = 32;
const TAIL_BARS = 16; // empty room to keep composing past the last note

const canvas = document.getElementById('roll-canvas') as HTMLCanvasElement;
const helpPanel = document.getElementById('help')!;

const store = new Store();
const vp = new Viewport();
const overlay = createOverlay();

const ctx = getAudioContext();
const piano = new Piano(ctx, createMasterBus(ctx));
const transport = new Transport(store, piano);

let dirty = true;
const invalidate = () => (dirty = true);

const renderer = new Renderer(canvas, store, vp, overlay, () => transport.currentBeat());
const editor = new Editor(canvas, store, vp, overlay, piano, transport, invalidate);

/** Bring the playhead into view if it is off-screen. */
function revealPlayhead(): void {
  const x = vp.beatToX(store.position);
  if (x < 0 || x > vp.width - 8) vp.scrollTo(store.position * vp.pxPerBeat - vp.width * 0.1, vp.scrollY);
  followArmed = true;
  invalidate();
}

const toggleHelp = (show?: boolean) => {
  helpPanel.hidden = show === undefined ? !helpPanel.hidden : !show;
};

const keyboard = new ComputerKeyboard(store, piano, (held) => {
  overlay.heldKeys = held;
  invalidate();
});

/** After opening a track: back to the start, centred on its notes. */
function showDocument(): void {
  const pitches = store.notes.map((n) => n.pitch).sort((a, b) => a - b);
  vp.scrollTo(0, vp.scrollY);
  vp.centerOnPitch(pitches.length ? pitches[Math.floor(pitches.length / 2)] : 66);
  followArmed = true;
  invalidate();
}

const session = new Session(store, transport, showDocument);

const bar = mountTransportBar(store, transport, {
  onHelp: () => toggleHelp(),
  onPlay: revealPlayhead,
  onReturn: revealPlayhead,
  onKeys: () => keyboard.toggle(),
});
const fileBar = mountFileBar(session, { onToggleSidebar: toggleSidebar });
mountSidebar(session);
installShortcuts({
  store,
  transport,
  vp,
  invalidate,
  toggleHelp,
  revealPlayhead,
  keyboard,
  file: { save: (asCopy) => void session.save(asCopy), open: fileBar.openFilePicker },
});

function toggleSidebar(): void {
  const hidden = document.body.classList.toggle('sidebar-hidden');
  try {
    localStorage.setItem('piano:sidebar', hidden ? 'hidden' : 'shown');
  } catch {
    // only a convenience
  }
}
try {
  if (localStorage.getItem('piano:sidebar') === 'hidden') document.body.classList.add('sidebar-hidden');
} catch {
  // ignore
}

// Reloading or closing with unsaved work asks first.
window.addEventListener('beforeunload', (e) => {
  if (session.dirty) e.preventDefault();
});
helpPanel.addEventListener('click', () => toggleHelp(false));

store.subscribe(() => {
  editor.refreshHover();
  invalidate();
});

bar.setStatus('loading');
piano.load(`${import.meta.env.BASE_URL}samples/salamander/`).then((s) => bar.setStatus(s));
void session.init();

// --- layout ---------------------------------------------------------------

function updateContentLength(): void {
  const last = store.notes.reduce((m, n) => Math.max(m, noteEnd(n)), 0);
  const beats = Math.max(MIN_BARS * BEATS_PER_BAR, last, store.position) + TAIL_BARS * BEATS_PER_BAR;
  vp.contentBeats = Math.ceil(beats / BEATS_PER_BAR) * BEATS_PER_BAR;
}

new ResizeObserver(() => {
  renderer.resize();
  invalidate();
}).observe(canvas.parentElement!);
renderer.resize();
vp.centerOnPitch(66); // middle C (C3) a little below centre

// --- follow playback --------------------------------------------------------
// Like Live's Follow: when the playhead runs off the right edge, flip to the next page.
// If the user has scrolled away from the playhead, leave the view alone until it's back in sight.
let followArmed = true;

function follow(beat: number): void {
  const x = vp.beatToX(beat);
  const visible = x >= 0 && x <= vp.width;
  if (followArmed && x > vp.width - 2) {
    vp.scrollTo(beat * vp.pxPerBeat - 12, vp.scrollY);
    return;
  }
  followArmed = visible;
}

// --- frame loop -------------------------------------------------------------

function frame(): void {
  if (store.playing) {
    const beat = transport.currentBeat();
    store.setPosition(beat);
    follow(beat);
    dirty = true;
  }
  updateContentLength();
  editor.autoscroll();
  if (dirty) {
    renderer.render();
    dirty = false;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

if (import.meta.env.DEV) {
  Object.assign(window, { __piano: { store, vp, transport, piano, overlay, session, keyboard } });
}
