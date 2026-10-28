// Mouse/trackpad interaction for the piano roll, modelled on Ableton Live's MIDI editor:
//  - Selection mode: click selects, drag moves, edges resize, empty drag = marquee,
//    double-click empty = new note, double-click note = delete, Option-drag = copy,
//    Cmd while dragging bypasses snapping, Shift-click toggles selection.
//  - Draw mode (B): click/drag paints grid-length notes that follow the mouse pitch
//    (hold Option to lock pitch); clicking a note erases it, dragging keeps erasing.
//  - Boneless (snap off): nothing snaps; draw mode places notes exactly under the mouse.
//  - Velocity lane: drag a stem up/down (selected stems move together); in draw mode, sweep
//    across the lane to paint velocities.
//  - Keyboard: click/drag to audition; Shift-click selects every note of that key.
//  - Ruler: top lane holds the loop brace (drag body to move, edges to resize, empty lane to draw a
//    new loop, click to switch it on/off); middle strip scrubs the playhead; bottom strip drag
//    zooms (vertical) / scrolls (horizontal).
import { getAudioContext, unlockAudio } from '../audio/context';
import type { Instrument, Voice } from '../audio/instrument';
import { clampPitch, MAX_PITCH, MIN_PITCH, PITCH_COUNT } from '../music/pitch';
import { DEFAULT_VELOCITY, noteEnd, type Note } from '../model/note';
import type { Transport } from '../playback/transport';
import { KEYS_W, LOOP_H, regionAt as regionAtXY, RULER_H, SCRUB_H, yToVelocity } from '../render/layout';
import type { NoteZone, Overlay } from '../render/overlay';
import type { LoopSettings, Store } from '../state/store';
import { EPS, gridStep, snapFloor, snapRound } from '../timeline/grid';
import type { Viewport } from '../timeline/viewport';
import { addNote, deleteNote } from './commands';

const DRAG_THRESHOLD = 3; // px before a click becomes a move/resize
const DOUBLE_CLICK_MS = 350;
const EDGE_PX = 7;
const AUTOSCROLL_MAX = 28; // px per frame

const PENCIL_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 20 20'><path d='M3 17l1.2-4.2L13.6 3.4l3 3-9.4 9.4z' fill='white' stroke='black' stroke-width='1.2' stroke-linejoin='round'/><path d='M3 17l1.2-4.2 3 3z' fill='black'/></svg>",
)}") 3 17, crosshair`;

interface Point {
  x: number;
  y: number;
}

interface Mods {
  alt: boolean;
  meta: boolean;
  shift: boolean;
}

type Drag =
  | {
      kind: 'move';
      cx0: number; // content-space pointer origin
      cy0: number;
      started: boolean;
      anchor: Note;
      base: Note[];
      moving: Note[];
      copyIds: Map<number, number>;
      selectOnlyOnClick: number | null;
      lastPitch: number;
    }
  | { kind: 'resize'; edge: 'start' | 'end'; cx0: number; started: boolean; anchor: Note; base: Note[]; ids: Set<number> }
  | { kind: 'marquee'; additive: boolean; baseSel: number[] }
  | { kind: 'draw'; steps: Map<number, number>; lastStep: number; lastPitch: number; lockPitch: number }
  | { kind: 'drawFree'; currentId: number; lastStart: number; lockPitch: number }
  | { kind: 'velocity'; anchor: Note; ids: Set<number>; base: Note[]; started: boolean; y0: number }
  | { kind: 'velocityPaint'; lastX: number }
  | { kind: 'erase' }
  | { kind: 'scrub' }
  | { kind: 'rulerZoom'; last: Point; moved: boolean; origin: Point }
  | { kind: 'key'; pitch: number }
  | { kind: 'loop'; mode: LoopZone; originBeat: number; originX: number; base: LoopSettings; moved: boolean };

type LoopZone = 'start' | 'end' | 'move' | 'new';

export class Editor {
  private drag: Drag | null = null;
  private mods: Mods = { alt: false, meta: false, shift: false };
  private last: Point = { x: -1, y: -1 };
  private lastDown = { time: 0, x: 0, y: 0 };
  private preview: { pitch: number; voice: Voice } | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private store: Store,
    private vp: Viewport,
    private overlay: Overlay,
    private instrument: Instrument,
    private transport: Transport,
    private invalidate: () => void,
  ) {
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointercancel', (e) => this.onUp(e));
    canvas.addEventListener('pointerleave', () => {
      if (!this.drag) this.clearHover();
    });
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this.onModifier(e));
    window.addEventListener('keyup', (e) => this.onModifier(e));
    window.addEventListener('blur', () => this.cancelPreview());
  }

  get dragging(): boolean {
    return this.drag !== null;
  }

  // ------------------------------------------------------------ coordinates

  private local(e: { clientX: number; clientY: number }): Point {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /** Pointer in content space: pixels from beat 0 / the top of pitch 127. */
  private content(p: Point): Point {
    return { x: p.x - KEYS_W + this.vp.scrollX, y: p.y - RULER_H + this.vp.scrollY };
  }

  private beatAt(p: Point): number {
    return this.vp.xToBeat(p.x - KEYS_W);
  }

  private pitchAt(p: Point): number {
    return this.vp.yToPitch(p.y - RULER_H);
  }

  private get step(): number {
    return gridStep(this.store.grid);
  }

  private snapping(): boolean {
    return this.store.grid.snap && !this.mods.meta;
  }

  private hit(p: Point): { note: Note; zone: NoteZone } | null {
    const pitch = this.pitchAt(p);
    const ppb = this.vp.pxPerBeat;
    const px = this.beatAt(p) * ppb;
    const notes = this.store.notes;
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i];
      if (n.pitch !== pitch) continue;
      const xs = n.start * ppb;
      const xe = noteEnd(n) * ppb;
      if (px < xs || px > xe + 2) continue;
      const edge = Math.min(EDGE_PX, (xe - xs) / 3);
      if (xe - px <= edge) return { note: n, zone: 'end' };
      if (px - xs <= edge) return { note: n, zone: 'start' };
      if (px < xe) return { note: n, zone: 'body' };
    }
    return null;
  }

  private regionAt(x: number, y: number) {
    return regionAtXY(x, y, this.canvas.clientHeight);
  }

  /** Nearest velocity stem within a few px of the pointer (selected stems win ties). */
  private stemAt(p: Point): Note | null {
    let best: Note | null = null;
    let bestD = 6;
    for (const n of this.store.notes) {
      const d = Math.abs(this.vp.beatToX(n.start) + KEYS_W - p.x);
      const sel = this.store.selection.has(n.id);
      if (d < bestD || (d === bestD && sel)) {
        best = n;
        bestD = d;
      }
    }
    return best;
  }

  private downVelocity(p: Point): void {
    if (this.store.drawMode) {
      this.store.checkpoint();
      this.drag = { kind: 'velocityPaint', lastX: p.x };
      this.paintVelocity(p.x, p.x, p.y);
      return;
    }
    const n = this.stemAt(p);
    if (!n) return;
    if (!this.store.selection.has(n.id) && !this.mods.shift) this.store.setSelection([n.id]);
    else if (!this.store.selection.has(n.id)) this.store.setSelection([...this.store.selection, n.id]);
    this.overlay.velocityNote = n.id;
    this.drag = {
      kind: 'velocity',
      anchor: n,
      ids: new Set(this.store.selection),
      base: this.store.notes,
      started: false,
      y0: p.y,
    };
  }

  private dragVelocity(d: Extract<Drag, { kind: 'velocity' }>, p: Point): void {
    if (!d.started) {
      if (Math.abs(p.y - d.y0) < 2) return;
      d.started = true;
      this.store.checkpoint();
    }
    // The grabbed stem follows the mouse; other selected notes move by the same amount.
    const delta = yToVelocity(p.y, this.canvas.clientHeight) - d.anchor.velocity;
    const clamp = (v: number) => Math.max(1, Math.min(127, v));
    this.store.setNotes(d.base.map((n) => (d.ids.has(n.id) ? { ...n, velocity: clamp(n.velocity + delta) } : n)));
  }

  /** Draw-mode sweep: every note whose start lies between the last and current x gets this velocity. */
  private paintVelocity(x0: number, x1: number, y: number): void {
    const lo = Math.min(x0, x1) - 3;
    const hi = Math.max(x0, x1) + 3;
    const v = yToVelocity(y, this.canvas.clientHeight);
    let changed = false;
    const notes = this.store.notes.map((n) => {
      const x = this.vp.beatToX(n.start) + KEYS_W;
      if (x < lo || x > hi || n.velocity === v) return n;
      changed = true;
      return { ...n, velocity: v };
    });
    if (changed) this.store.setNotes(notes);
  }

  // ------------------------------------------------------------ audition

  private audition(pitch: number): void {
    if (this.preview?.pitch === pitch) return;
    this.cancelPreview();
    unlockAudio();
    const ctx = getAudioContext();
    this.preview = { pitch, voice: this.instrument.noteOn(pitch, DEFAULT_VELOCITY, ctx.currentTime) };
    this.overlay.pressedKeys = new Set([pitch]);
  }

  private cancelPreview(): void {
    if (!this.preview) return;
    this.preview.voice.release(getAudioContext().currentTime);
    this.preview = null;
    this.overlay.pressedKeys = new Set();
    this.invalidate();
  }

  // ------------------------------------------------------------ pointer down

  private onDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    this.syncMods(e);
    unlockAudio();
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.local(e);
    this.last = p;

    const now = performance.now();
    const isDouble =
      now - this.lastDown.time < DOUBLE_CLICK_MS && Math.hypot(p.x - this.lastDown.x, p.y - this.lastDown.y) < 6;
    this.lastDown = isDouble ? { time: 0, x: 0, y: 0 } : { time: now, x: p.x, y: p.y };

    switch (this.regionAt(p.x, p.y)) {
      case 'grid':
        if (this.store.drawMode) this.downDraw(p);
        else this.downSelect(p, isDouble);
        break;
      case 'keys':
        this.downKeys(p);
        break;
      case 'velocity':
        this.downVelocity(p);
        break;
      case 'ruler':
        if (p.y < LOOP_H) {
          this.drag = {
            kind: 'loop',
            mode: this.loopZone(p),
            originBeat: this.beatAt(p),
            originX: p.x,
            base: this.store.loop,
            moved: false,
          };
        } else if (p.y < LOOP_H + SCRUB_H) {
          this.drag = { kind: 'scrub' };
          this.scrubTo(p);
        } else {
          this.drag = { kind: 'rulerZoom', last: p, origin: p, moved: false };
        }
        break;
    }
    this.updateCursor(p);
    this.invalidate();
  }

  private downSelect(p: Point, isDouble: boolean): void {
    const { store } = this;
    const h = this.hit(p);

    if (isDouble) {
      if (h) deleteNote(store, h.note.id);
      else {
        const pitch = this.pitchAt(p);
        if (pitch < MIN_PITCH || pitch > MAX_PITCH) return;
        const start = this.snapping() ? snapFloor(this.beatAt(p), this.step) : this.beatAt(p);
        addNote(store, pitch, start, this.step);
        this.audition(pitch);
      }
      return;
    }

    if (!h) {
      const additive = this.mods.shift;
      if (!additive) store.setSelection([]);
      const c = this.content(p);
      this.overlay.marquee = { x0: c.x, y0: c.y, x1: c.x, y1: c.y };
      this.drag = { kind: 'marquee', additive, baseSel: [...store.selection] };
      return;
    }

    const id = h.note.id;
    let selectOnlyOnClick: number | null = null;
    if (this.mods.shift) {
      const sel = new Set(store.selection);
      if (sel.has(id)) {
        sel.delete(id);
        store.setSelection(sel);
        return;
      }
      sel.add(id);
      store.setSelection(sel);
    } else if (!store.selection.has(id)) {
      store.setSelection([id]);
    } else {
      selectOnlyOnClick = id; // clicking inside a multi-selection narrows it on release
    }

    const c = this.content(p);
    if (h.zone === 'body') {
      this.drag = {
        kind: 'move',
        cx0: c.x,
        cy0: c.y,
        started: false,
        anchor: h.note,
        base: store.notes,
        moving: store.selectedNotes(),
        copyIds: new Map(store.selectedNotes().map((n) => [n.id, store.newId()])),
        selectOnlyOnClick,
        lastPitch: h.note.pitch,
      };
      this.audition(h.note.pitch);
    } else {
      this.drag = {
        kind: 'resize',
        edge: h.zone,
        cx0: c.x,
        started: false,
        anchor: h.note,
        base: store.notes,
        ids: new Set(store.selection),
      };
    }
  }

  private downDraw(p: Point): void {
    const h = this.hit(p);
    if (h && h.zone !== 'body') {
      // Edges still resize in draw mode.
      this.store.setSelection([h.note.id]);
      this.drag = {
        kind: 'resize',
        edge: h.zone,
        cx0: this.content(p).x,
        started: false,
        anchor: h.note,
        base: this.store.notes,
        ids: new Set([h.note.id]),
      };
      return;
    }
    if (h) {
      this.store.checkpoint();
      this.store.setNotes(this.store.notes.filter((n) => n.id !== h.note.id));
      this.drag = { kind: 'erase' };
      return;
    }
    const pitch = this.pitchAt(p);
    if (pitch < MIN_PITCH || pitch > MAX_PITCH) return;
    this.store.checkpoint();
    if (!this.snapping()) {
      // Boneless: the note starts exactly under the mouse.
      const start = Math.max(0, this.beatAt(p));
      const note = this.store.makeNote(pitch, start, this.step);
      this.store.setNotes([...this.store.notes, note], [note.id]);
      this.drag = { kind: 'drawFree', currentId: note.id, lastStart: start, lockPitch: pitch };
      this.audition(pitch);
      this.overlay.ghost = null;
      return;
    }
    const step = this.stepIndex(p);
    this.drag = { kind: 'draw', steps: new Map(), lastStep: step, lastPitch: pitch, lockPitch: pitch };
    this.placeDrawn(step, pitch);
    this.overlay.ghost = null;
  }

  private downKeys(p: Point): void {
    const pitch = this.pitchAt(p);
    if (pitch < MIN_PITCH || pitch > MAX_PITCH) return;
    if (this.mods.shift) {
      this.store.setSelection(this.store.notes.filter((n) => n.pitch === pitch).map((n) => n.id));
    }
    this.drag = { kind: 'key', pitch };
    this.audition(pitch);
  }

  // ------------------------------------------------------------ pointer move

  private onMove(e: PointerEvent): void {
    this.syncMods(e);
    const p = this.local(e);
    this.last = p;
    if (this.drag) this.dragTo(p);
    else this.hover(p);
    this.updateCursor(p);
    this.invalidate();
  }

  private dragTo(p: Point): void {
    const d = this.drag!;
    switch (d.kind) {
      case 'move':
        return this.dragMove(d, p);
      case 'resize':
        return this.dragResize(d, p);
      case 'marquee':
        return this.dragMarquee(d, p);
      case 'draw':
        return this.dragDraw(d, p);
      case 'drawFree':
        return this.dragDrawFree(d, p);
      case 'velocity':
        return this.dragVelocity(d, p);
      case 'velocityPaint':
        this.paintVelocity(d.lastX, p.x, p.y);
        d.lastX = p.x;
        return;
      case 'erase': {
        const h = this.hit(p);
        if (h) this.store.setNotes(this.store.notes.filter((n) => n.id !== h.note.id));
        return;
      }
      case 'scrub':
        return this.scrubTo(p);
      case 'loop':
        return this.dragLoop(d, p);
      case 'rulerZoom': {
        const dx = p.x - d.last.x;
        const dy = p.y - d.last.y;
        if (Math.abs(p.x - d.origin.x) + Math.abs(p.y - d.origin.y) > DRAG_THRESHOLD) d.moved = true;
        if (d.moved) {
          // Drag down zooms in around the pointer; drag sideways scrolls.
          this.vp.zoomX(Math.exp(dy * 0.012), p.x - KEYS_W);
          this.vp.scrollBy(-dx, 0);
        }
        d.last = p;
        return;
      }
      case 'key': {
        const pitch = clampPitch(this.pitchAt(p));
        if (pitch !== d.pitch) {
          d.pitch = pitch;
          this.audition(pitch);
        }
        this.overlay.hoverPitch = pitch;
        return;
      }
    }
  }

  private dragMove(d: Extract<Drag, { kind: 'move' }>, p: Point): void {
    const c = this.content(p);
    if (!d.started) {
      if (Math.hypot(c.x - d.cx0, c.y - d.cy0) < DRAG_THRESHOLD) return;
      d.started = true;
      this.store.checkpoint();
    }
    const vp = this.vp;
    const rawBeat = (c.x - d.cx0) / vp.pxPerBeat;
    let newStart = d.anchor.start + rawBeat;
    if (this.snapping()) newStart = snapRound(newStart, this.step);
    let dBeat = newStart - d.anchor.start;
    let dPitch = Math.floor(d.cy0 / vp.rowHeight) - Math.floor(c.y / vp.rowHeight);

    const minStart = Math.min(...d.moving.map((n) => n.start));
    if (minStart + dBeat < 0) dBeat = -minStart;
    const lo = Math.min(...d.moving.map((n) => n.pitch));
    const hi = Math.max(...d.moving.map((n) => n.pitch));
    dPitch = Math.max(MIN_PITCH - lo, Math.min(MAX_PITCH - hi, dPitch));

    const shift = (n: Note, id = n.id): Note => ({ ...n, id, start: n.start + dBeat, pitch: n.pitch + dPitch });
    const copy = this.mods.alt; // Option-drag copies; can be toggled mid-drag
    if (copy) {
      const copies = d.moving.map((n) => shift(n, d.copyIds.get(n.id)!));
      this.store.setNotes([...d.base, ...copies], copies.map((n) => n.id));
    } else {
      const ids = new Set(d.moving.map((n) => n.id));
      this.store.setNotes(
        d.base.map((n) => (ids.has(n.id) ? shift(n) : n)),
        ids,
      );
    }
    const pitch = d.anchor.pitch + dPitch;
    if (pitch !== d.lastPitch) {
      d.lastPitch = pitch;
      this.audition(pitch);
    }
  }

  private dragResize(d: Extract<Drag, { kind: 'resize' }>, p: Point): void {
    const c = this.content(p);
    if (!d.started) {
      if (Math.abs(c.x - d.cx0) < DRAG_THRESHOLD) return;
      d.started = true;
      this.store.checkpoint();
    }
    const rawBeat = (c.x - d.cx0) / this.vp.pxPerBeat;
    const snap = this.snapping();
    const step = this.step;
    const minDur = (n: Note) => (snap ? Math.min(step, n.duration) : 1 / 128);

    let notes: Note[];
    if (d.edge === 'end') {
      let newEnd = noteEnd(d.anchor) + rawBeat;
      if (snap) newEnd = snapRound(newEnd, step);
      const dEnd = newEnd - noteEnd(d.anchor);
      notes = d.base.map((n) =>
        d.ids.has(n.id) ? { ...n, duration: Math.max(minDur(n), n.duration + dEnd) } : n,
      );
    } else {
      let newStart = d.anchor.start + rawBeat;
      if (snap) newStart = snapRound(newStart, step);
      const dStart = newStart - d.anchor.start;
      notes = d.base.map((n) => {
        if (!d.ids.has(n.id)) return n;
        const end = noteEnd(n);
        const start = Math.max(0, Math.min(end - minDur(n), n.start + dStart));
        return { ...n, start, duration: end - start };
      });
    }
    this.store.setNotes(notes);
  }

  private dragMarquee(d: Extract<Drag, { kind: 'marquee' }>, p: Point): void {
    const m = this.overlay.marquee!;
    const c = this.content(p);
    m.x1 = c.x;
    m.y1 = c.y;
    const vp = this.vp;
    const b0 = Math.min(m.x0, m.x1) / vp.pxPerBeat;
    const b1 = Math.max(m.x0, m.x1) / vp.pxPerBeat;
    const pTop = PITCH_COUNT - 1 - Math.floor(Math.min(m.y0, m.y1) / vp.rowHeight);
    const pBottom = PITCH_COUNT - 1 - Math.floor(Math.max(m.y0, m.y1) / vp.rowHeight);
    const hits = this.store.notes
      .filter((n) => n.pitch <= pTop && n.pitch >= pBottom && n.start < b1 && noteEnd(n) > b0)
      .map((n) => n.id);
    this.store.setSelection(d.additive ? new Set([...d.baseSel, ...hits]) : hits);
  }

  private stepIndex(p: Point): number {
    return Math.floor(this.beatAt(p) / this.step + EPS);
  }

  private dragDraw(d: Extract<Drag, { kind: 'draw' }>, p: Point): void {
    const s = this.stepIndex(p);
    const target = this.mods.alt ? d.lockPitch : clampPitch(this.pitchAt(p));
    if (s === d.lastStep) {
      this.placeDrawn(s, target);
    } else {
      // Fill skipped steps when the mouse moves fast, interpolating pitch.
      const dir = Math.sign(s - d.lastStep);
      const span = Math.abs(s - d.lastStep);
      for (let i = 1; i <= span; i++) {
        const k = d.lastStep + dir * i;
        this.placeDrawn(k, Math.round(d.lastPitch + ((target - d.lastPitch) * i) / span));
      }
    }
    d.lastStep = s;
    d.lastPitch = target;
  }

  /** Boneless painting: a new note each time the mouse travels one note-length; otherwise re-pitch. */
  private dragDrawFree(d: Extract<Drag, { kind: 'drawFree' }>, p: Point): void {
    const len = this.step;
    const beat = Math.max(0, this.beatAt(p));
    const pitch = this.mods.alt ? d.lockPitch : clampPitch(this.pitchAt(p));
    const { store } = this;
    if (Math.abs(beat - d.lastStart) >= len) {
      if (this.occupied(pitch, beat, len)) return;
      const note = store.makeNote(pitch, beat, len);
      d.currentId = note.id;
      d.lastStart = beat;
      store.setNotes([...store.notes, note], [...store.selection, note.id]);
      this.audition(pitch);
      return;
    }
    const cur = store.notes.find((n) => n.id === d.currentId);
    if (!cur || cur.pitch === pitch || this.occupied(pitch, cur.start, cur.duration, cur.id)) return;
    store.setNotes(store.notes.map((n) => (n.id === d.currentId ? { ...n, pitch } : n)));
    this.audition(pitch);
  }

  /** One drawn note per grid step; moving vertically within a step re-pitches it. */
  private placeDrawn(stepIdx: number, pitch: number): void {
    const d = this.drag;
    if (d?.kind !== 'draw' || stepIdx < 0) return;
    const step = this.step;
    const start = stepIdx * step;
    const existingId = d.steps.get(stepIdx);
    const { store } = this;
    if (existingId !== undefined) {
      const cur = store.notes.find((n) => n.id === existingId);
      if (!cur || cur.pitch === pitch) return;
      if (this.occupied(pitch, start, step, existingId)) return;
      store.setNotes(store.notes.map((n) => (n.id === existingId ? { ...n, pitch } : n)));
    } else {
      if (this.occupied(pitch, start, step)) return;
      const note = store.makeNote(pitch, start, step);
      d.steps.set(stepIdx, note.id);
      store.setNotes([...store.notes, note], [...d.steps.values()]);
    }
    this.audition(pitch);
  }

  private occupied(pitch: number, start: number, dur: number, except?: number): boolean {
    return this.store.notes.some(
      (n) => n.id !== except && n.pitch === pitch && n.start < start + dur - EPS && noteEnd(n) > start + EPS,
    );
  }

  private loopZone(p: Point): LoopZone {
    const { start, end } = this.store.loop;
    const x = p.x - KEYS_W;
    const x0 = this.vp.beatToX(start);
    const x1 = this.vp.beatToX(end);
    const edge = Math.min(6, (x1 - x0) / 3);
    if (Math.abs(x - x0) <= edge) return 'start';
    if (Math.abs(x - x1) <= edge) return 'end';
    if (x > x0 && x < x1) return 'move';
    return 'new';
  }

  private dragLoop(d: Extract<Drag, { kind: 'loop' }>, p: Point): void {
    if (!d.moved && Math.abs(p.x - d.originX) < DRAG_THRESHOLD) return;
    d.moved = true;
    const step = this.snapping() ? this.step : 1 / 64;
    const snap = (b: number) => Math.max(0, this.snapping() ? snapRound(b, step) : b);
    const beat = this.beatAt(p);
    const { base } = d;
    switch (d.mode) {
      case 'move': {
        const len = base.end - base.start;
        const start = snap(base.start + beat - d.originBeat);
        return this.store.setLoop({ start, end: start + len });
      }
      case 'start':
        return this.store.setLoop({ start: Math.min(snap(beat), base.end - step) });
      case 'end':
        return this.store.setLoop({ end: Math.max(snap(beat), base.start + step) });
      case 'new': {
        const a = snap(d.originBeat);
        const b = snap(beat);
        if (Math.abs(b - a) >= step - 1e-9) this.store.setLoop({ start: Math.min(a, b), end: Math.max(a, b), enabled: true });
        return;
      }
    }
  }

  private scrubTo(p: Point): void {
    let beat = Math.max(0, this.beatAt(p));
    if (this.snapping()) beat = snapRound(beat, this.step);
    if (Math.abs(beat - this.store.position) > EPS || !this.store.playing) this.transport.seek(beat);
  }

  // ------------------------------------------------------------ pointer up

  private onUp(e: PointerEvent): void {
    const d = this.drag;
    this.drag = null;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (d?.kind === 'move' && !d.started && d.selectOnlyOnClick !== null) {
      this.store.setSelection([d.selectOnlyOnClick]);
    }
    if (d?.kind === 'rulerZoom' && !d.moved) this.scrubTo(d.origin);
    // Clicking the brace switches the loop on/off, as in Live.
    if (d?.kind === 'loop' && !d.moved && d.mode !== 'new') this.store.setLoop({ enabled: !this.store.loop.enabled });
    this.overlay.marquee = null;
    this.cancelPreview();
    const p = this.local(e);
    this.hover(p);
    this.updateCursor(p);
    this.invalidate();
  }

  // ------------------------------------------------------------ hover & cursor

  private hover(p: Point): void {
    const o = this.overlay;
    const region = this.regionAt(p.x, p.y);
    o.hoverNote = null;
    o.hoverZone = null;
    o.ghost = null;
    o.hoverPitch = null;
    o.velocityNote = region === 'velocity' && !this.store.drawMode ? (this.stemAt(p)?.id ?? null) : null;
    if (region === 'grid' || region === 'keys') {
      const pitch = this.pitchAt(p);
      if (pitch >= MIN_PITCH && pitch <= MAX_PITCH) o.hoverPitch = pitch;
    }
    if (region !== 'grid' || o.hoverPitch === null) return;
    const h = this.hit(p);
    if (h) {
      o.hoverNote = h.note.id;
      o.hoverZone = h.zone;
    } else if (this.store.drawMode) {
      const step = this.step;
      const start = this.snapping() ? Math.max(0, this.stepIndex(p)) * step : Math.max(0, this.beatAt(p));
      o.ghost = { pitch: o.hoverPitch, start, duration: step };
    }
  }

  private clearHover(): void {
    const o = this.overlay;
    o.hoverNote = o.hoverZone = o.ghost = o.hoverPitch = null;
    this.invalidate();
  }

  private updateCursor(p: Point): void {
    let cursor = 'default';
    const d = this.drag;
    if (d) {
      if (d.kind === 'resize') cursor = 'ew-resize';
      else if (d.kind === 'move') cursor = d.started ? (this.mods.alt ? 'copy' : 'grabbing') : 'default';
      else if (d.kind === 'draw' || d.kind === 'drawFree' || d.kind === 'erase' || d.kind === 'velocityPaint') cursor = PENCIL_CURSOR;
      else if (d.kind === 'velocity') cursor = 'ns-resize';
      else if (d.kind === 'rulerZoom') cursor = 'zoom-in';
      else if (d.kind === 'scrub') cursor = 'col-resize';
      else if (d.kind === 'loop') cursor = d.mode === 'move' ? 'grabbing' : d.mode === 'new' ? 'crosshair' : 'ew-resize';
    } else {
      const region = this.regionAt(p.x, p.y);
      if (region === 'grid') {
        const z = this.overlay.hoverZone;
        if (z === 'start' || z === 'end') cursor = 'ew-resize';
        else if (this.store.drawMode) cursor = PENCIL_CURSOR;
      } else if (region === 'ruler') {
        if (p.y < LOOP_H) {
          const z = this.loopZone(p);
          cursor = z === 'start' || z === 'end' ? 'ew-resize' : z === 'move' ? 'grab' : 'crosshair';
        } else cursor = p.y < LOOP_H + SCRUB_H ? 'pointer' : 'zoom-in';
      } else if (region === 'keys') {
        cursor = 'pointer';
      } else if (region === 'velocity') {
        cursor = this.store.drawMode ? PENCIL_CURSOR : this.overlay.velocityNote !== null ? 'ns-resize' : 'default';
      }
    }
    if (this.canvas.style.cursor !== cursor) this.canvas.style.cursor = cursor;
  }

  /** Re-evaluate hover after the store or view changed under a stationary mouse. */
  refreshHover(): void {
    if (this.drag || this.last.x < 0) return;
    this.hover(this.last);
    this.updateCursor(this.last);
  }

  // ------------------------------------------------------------ modifiers

  private syncMods(e: { altKey: boolean; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }): void {
    this.mods = { alt: e.altKey, meta: e.metaKey || e.ctrlKey, shift: e.shiftKey };
  }

  private onModifier(e: KeyboardEvent): void {
    if (e.key !== 'Alt' && e.key !== 'Meta' && e.key !== 'Control' && e.key !== 'Shift') return;
    this.syncMods(e);
    // Pressing/releasing Option mid-drag switches between move and copy, as in Live.
    if (this.drag) {
      this.dragTo(this.last);
      this.updateCursor(this.last);
      this.invalidate();
    }
  }

  // ------------------------------------------------------------ wheel & autoscroll

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const p = this.local(e);
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.vp.height : 1;
    let dx = e.deltaX * unit;
    let dy = e.deltaY * unit;

    if (e.ctrlKey || e.metaKey) {
      // Trackpad pinch arrives as ctrl+wheel; Cmd+wheel zooms time, as in Live.
      const k = e.ctrlKey && !e.metaKey ? 0.012 : 0.004;
      this.vp.zoomX(Math.exp(-Math.max(-60, Math.min(60, dy)) * k), Math.max(0, p.x - KEYS_W));
    } else if (e.altKey) {
      this.vp.zoomY(Math.exp(-Math.max(-60, Math.min(60, dy)) * 0.006), Math.max(0, p.y - RULER_H));
    } else {
      if (e.shiftKey && dx === 0) [dx, dy] = [dy, 0];
      this.vp.scrollBy(dx, dy);
    }
    this.hover(p);
    this.updateCursor(p);
    if (this.drag) this.dragTo(p);
    this.invalidate();
  }

  /** Called every frame: scroll when dragging past the grid edges. */
  autoscroll(): void {
    const d = this.drag;
    if (!d || !['move', 'resize', 'marquee', 'draw', 'drawFree', 'erase'].includes(d.kind)) return;
    const { x, y } = this.last;
    const vp = this.vp;
    const gx = x - KEYS_W;
    const gy = y - RULER_H;
    const speed = (over: number) => Math.sign(over) * Math.min(AUTOSCROLL_MAX, Math.abs(over) * 0.35);
    const dx = gx < 0 ? speed(gx) : gx > vp.width ? speed(gx - vp.width) : 0;
    const dy = gy < 0 ? speed(gy) : gy > vp.height ? speed(gy - vp.height) : 0;
    if (!dx && !dy) return;
    const sx = vp.scrollX;
    const sy = vp.scrollY;
    vp.scrollBy(dx, dy);
    if (vp.scrollX !== sx || vp.scrollY !== sy) {
      this.dragTo(this.last);
      this.invalidate();
    }
  }
}
