// Mouse/trackpad interaction for the piano roll, modelled on Ableton Live's MIDI editor:
//  - Selection mode: click selects, drag moves, edges resize, empty drag = marquee,
//    double-click empty = new note, double-click note = delete, Option-drag = copy,
//    Cmd while dragging bypasses snapping, Shift-click toggles selection.
//  - Draw mode (B): click/drag paints grid-length notes that follow the mouse pitch
//    (hold Option to lock pitch); clicking a note erases it, dragging keeps erasing.
//  - Boneless (snap off): nothing snaps; draw mode places notes exactly under the mouse.
//  - Velocity lane: drag a stem up/down (selected stems move together); in draw mode, sweep
//    across the lane to paint velocities. Cmd-drag (or drag from empty lane) draws a straight
//    ramp: notes under the line get velocities along it (the selection only, if there is one).
//  - Keyboard (Live's note ruler): click to audition (drag up/down for a glissando); drag
//    left/right to zoom key-track height; double-click to fit the notes (or the selection) to the
//    view; Shift-click adds/removes every note of that key to/from the selection.
//  - Ruler: the loop lane holds the loop brace (drag body to move, edges to resize, empty lane to
//    draw a new loop, click to switch it on/off); the scrub strip moves the playhead; dragging the
//    beat strip zooms (vertical) / scrolls (horizontal).
import { getAudioContext, playNow, unlockAudio } from '../audio/context';
import type { Instrument, Voice } from '../audio/instrument';
import { clampPitch, isValidPitch, MAX_PITCH, MIN_PITCH } from '../music/pitch';
import { clampVelocity, DEFAULT_VELOCITY, noteBounds, noteEnd, type Note } from '../model/note';
import type { Transport } from '../playback/transport';
import { KEYS_W, type Layout, type Point, type Region } from '../render/layout';
import type { Overlay } from '../render/overlay';
import type { LoopSettings, Store } from '../state/store';
import { EPS, gridStep, snapFloor, snapRound } from '../timeline/grid';
import type { Viewport } from '../timeline/viewport';
import { addNote, deleteNote } from './commands';

const DRAG_THRESHOLD = 3; // px before a click becomes a drag
const DOUBLE_CLICK_MS = 350;
const EDGE_PX = 7;
const AUTOSCROLL_MAX = 28; // px per frame
const AUDITION_GAP_MS = 70; // minimum time between replays of the same note while dragging
const AUDITION_RING = 0.4; // seconds a previewed note sounds at least, so a quick drag is still heard
const CHORD_PREVIEW_MAX = 6; // notes heard when a selection moves with the arrow keys

const PENCIL_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 20 20'><path d='M3 17l1.2-4.2L13.6 3.4l3 3-9.4 9.4z' fill='white' stroke='black' stroke-width='1.2' stroke-linejoin='round'/><path d='M3 17l1.2-4.2 3 3z' fill='black'/></svg>",
)}") 3 17, crosshair`;

type NoteZone = 'body' | 'start' | 'end';
type LoopZone = 'start' | 'end' | 'move' | 'new';

interface Mods {
  alt: boolean;
  meta: boolean;
  shift: boolean;
}

/** Every drag remembers where it began (canvas px) and whether it has passed the threshold. */
interface DragBase {
  origin: Point;
  started: boolean;
}

type Drag = DragBase &
  (
    | {
        kind: 'move';
        anchor: Note;
        base: Note[];
        moving: Note[];
        ids: Set<number>;
        bounds: { start: number; lo: number; hi: number };
        copyIds: Map<number, number>;
        selectOnlyOnClick: number | null;
        lastPitch: number;
        lastBeat: number;
        scroll0: Point; // viewport scroll at drag start, so autoscroll moves the notes too
      }
    | { kind: 'resize'; edge: 'start' | 'end'; anchor: Note; base: Note[]; ids: Set<number>; scroll0: number }
    | { kind: 'marquee'; additive: boolean; baseSel: number[] }
    | { kind: 'draw'; steps: Map<number, number>; lastStep: number; lastPitch: number; lockPitch: number }
    | { kind: 'drawFree'; currentId: number; lastStart: number; lockPitch: number }
    | { kind: 'velocity'; anchor: Note; ids: Set<number>; base: Note[] }
    | { kind: 'velocityPaint'; lastX: number }
    | { kind: 'velocityRamp'; base: Note[]; ids: Set<number> | null }
    | { kind: 'erase' }
    | { kind: 'scrub' }
    | { kind: 'rulerZoom'; last: Point }
    | { kind: 'key'; pitch: number; last: Point; zooming: boolean }
    | { kind: 'loop'; mode: LoopZone; originBeat: number; base: LoopSettings }
  );

type DragOf<K extends Drag['kind']> = Extract<Drag, { kind: K }>;

/** Drags that scroll the view when the pointer leaves the grid. */
const AUTOSCROLLING = new Set<Drag['kind']>(['move', 'resize', 'marquee', 'draw', 'drawFree', 'erase']);

export class Editor {
  private drag: Drag | null = null;
  private mods: Mods = { alt: false, meta: false, shift: false };
  private last: Point = { x: -1, y: -1 };
  private lastDown = { time: 0, x: 0, y: 0 };
  private preview: { pitch: number; voice: Voice; at: number } | null = null;
  private chord: Voice[] = [];
  private hoverZone: NoteZone | null = null;
  private lastAudition = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private store: Store,
    private vp: Viewport,
    private layout: Layout,
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

  // ------------------------------------------------------------ coordinates

  private local(e: { clientX: number; clientY: number }): Point {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private region(p: Point): Region {
    return this.layout.regionAt(p);
  }

  /** Pointer in content space: pixels from beat 0 / the top of pitch 127. */
  private content(p: Point): Point {
    const g = this.layout.toGrid(p);
    return { x: g.x + this.vp.scrollX, y: g.y + this.vp.scrollY };
  }

  private beatAt(p: Point): number {
    return this.vp.xToBeat(this.layout.toGrid(p).x);
  }

  private pitchAt(p: Point): number {
    return this.vp.yToPitch(this.layout.toGrid(p).y);
  }

  /** Canvas x of a beat. */
  private xOf(beat: number): number {
    return this.vp.beatToX(beat) + KEYS_W;
  }

  private get step(): number {
    return gridStep(this.store.grid);
  }

  private snapping(): boolean {
    return this.store.grid.snap && !this.mods.meta;
  }

  /** Snap a beat to the grid unless Boneless (or ⌘) is on. */
  private snap(beat: number, mode: 'round' | 'floor' = 'round'): number {
    if (!this.snapping()) return beat;
    return mode === 'round' ? snapRound(beat, this.step) : snapFloor(beat, this.step);
  }

  /**
   * True once the pointer has moved past the threshold. The first time, optionally takes an undo
   * checkpoint, so a plain click never creates an undo step.
   */
  private begin(d: Drag, p: Point, checkpoint = true): boolean {
    if (d.started) return true;
    if (Math.hypot(p.x - d.origin.x, p.y - d.origin.y) < DRAG_THRESHOLD) return false;
    d.started = true;
    if (checkpoint) this.store.checkpoint();
    return true;
  }

  private startDrag<T extends Omit<Drag, keyof DragBase>>(p: Point, d: T): void {
    this.drag = { origin: p, started: false, ...d } as Drag;
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

  /** Nearest velocity stem within a few px of the pointer (selected stems win ties). */
  private stemAt(p: Point): Note | null {
    let best: Note | null = null;
    let bestD = 6;
    for (const n of this.store.notes) {
      const d = Math.abs(this.xOf(n.start) - p.x);
      if (d < bestD || (d === bestD && this.store.selection.has(n.id))) {
        best = n;
        bestD = d;
      }
    }
    return best;
  }

  private occupied(pitch: number, start: number, dur: number, except?: number): boolean {
    return this.store.notes.some(
      (n) => n.id !== except && n.pitch === pitch && n.start < start + dur - EPS && noteEnd(n) > start + EPS,
    );
  }

  // ------------------------------------------------------------ audition

  /**
   * Play a note as feedback while editing. `retrigger` replays it even if that pitch is already
   * sounding (a newly drawn note, or a note moved to a new spot), throttled so fast drags don't
   * machine-gun.
   */
  private audition(pitch: number, retrigger = false): void {
    if (this.preview?.pitch === pitch && !retrigger) return;
    const now = performance.now();
    if (retrigger && this.preview?.pitch === pitch && now - this.lastAudition < AUDITION_GAP_MS) return;
    this.lastAudition = now;
    this.cancelPreview();
    this.preview = { pitch, voice: playNow(this.instrument, pitch, DEFAULT_VELOCITY), at: getAudioContext().currentTime };
    this.overlay.pressedKeys = new Set([pitch]);
  }

  /** Play the selected notes together (capped), e.g. after the arrow keys move them. */
  previewSelection(): void {
    const now = getAudioContext().currentTime;
    for (const v of this.chord) v.release(now);
    const pitches = [...new Set(this.store.selectedNotes().map((n) => n.pitch))].slice(0, CHORD_PREVIEW_MAX);
    const velocity = Math.round(DEFAULT_VELOCITY / Math.sqrt(Math.max(1, pitches.length))); // a chord shouldn't be louder than a note
    this.chord = pitches.map((p) => {
      const v = playNow(this.instrument, p, velocity);
      v.release(now + AUDITION_RING);
      return v;
    });
  }

  /** Stop the preview note; `ring` lets it sound at least AUDITION_RING seconds from its onset. */
  private cancelPreview(ring = false): void {
    if (!this.preview) return;
    const now = getAudioContext().currentTime;
    this.preview.voice.release(ring ? Math.max(now, this.preview.at + AUDITION_RING) : now);
    this.preview = null;
    this.overlay.pressedKeys = new Set();
    this.invalidate();
  }

  // ------------------------------------------------------------ pointer down

  private onDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    if (this.store.view === 'falling') {
      unlockAudio();
      this.transport.toggle(); // Synthesia mode: click to play / pause
      return;
    }
    this.syncMods(e);
    unlockAudio();
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.local(e);
    this.last = p;

    const now = performance.now();
    const isDouble =
      now - this.lastDown.time < DOUBLE_CLICK_MS && Math.hypot(p.x - this.lastDown.x, p.y - this.lastDown.y) < 6;
    this.lastDown = isDouble ? { time: 0, x: 0, y: 0 } : { time: now, x: p.x, y: p.y };

    switch (this.region(p)) {
      case 'grid':
        if (this.store.drawMode) this.downDraw(p);
        else this.downSelect(p, isDouble);
        break;
      case 'keys':
        if (isDouble) this.fitKeys();
        else this.downKeys(p);
        break;
      case 'velocity':
        this.downVelocity(p);
        break;
      case 'loop':
        this.startDrag(p, { kind: 'loop', mode: this.loopZone(p), originBeat: this.beatAt(p), base: this.store.loop });
        break;
      case 'scrub':
        this.startDrag(p, { kind: 'scrub' });
        this.scrubTo(p);
        break;
      case 'beat':
        this.startDrag(p, { kind: 'rulerZoom', last: p });
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
        if (!isValidPitch(pitch)) return;
        addNote(store, pitch, this.snap(this.beatAt(p), 'floor'), this.step);
        this.audition(pitch);
      }
      return;
    }

    if (!h) {
      const additive = this.mods.shift;
      if (!additive) store.setSelection([]);
      const c = this.content(p);
      this.overlay.marquee = { x0: c.x, y0: c.y, x1: c.x, y1: c.y };
      this.startDrag(p, { kind: 'marquee', additive, baseSel: [...store.selection] });
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
      store.setSelection(sel.add(id));
    } else if (!store.selection.has(id)) {
      store.setSelection([id]);
    } else {
      selectOnlyOnClick = id; // clicking inside a multi-selection narrows it on release
    }

    if (h.zone !== 'body') return this.startResize(p, h.note, h.zone, store.selection);
    const moving = store.selectedNotes();
    this.startDrag(p, {
      kind: 'move',
      anchor: h.note,
      base: store.notes,
      moving,
      ids: new Set(moving.map((n) => n.id)),
      bounds: noteBounds(moving),
      copyIds: new Map(moving.map((n) => [n.id, store.newId()])),
      selectOnlyOnClick,
      lastPitch: h.note.pitch,
      lastBeat: 0,
      scroll0: { x: this.vp.scrollX, y: this.vp.scrollY },
    });
    this.audition(h.note.pitch);
  }

  private startResize(p: Point, anchor: Note, edge: 'start' | 'end', ids: Iterable<number>): void {
    this.startDrag(p, { kind: 'resize', edge, anchor, base: this.store.notes, ids: new Set(ids), scroll0: this.vp.scrollX });
  }

  private downDraw(p: Point): void {
    const { store } = this;
    const h = this.hit(p);
    if (h && h.zone !== 'body') {
      // Edges still resize in draw mode.
      store.setSelection([h.note.id]);
      return this.startResize(p, h.note, h.zone, [h.note.id]);
    }
    if (h) {
      deleteNote(store, h.note.id);
      return this.startDrag(p, { kind: 'erase' });
    }
    const pitch = this.pitchAt(p);
    if (!isValidPitch(pitch)) return;
    store.checkpoint();
    this.overlay.ghost = null;
    if (!this.snapping()) {
      // Boneless: the note starts exactly under the mouse.
      const note = this.addDrawn(pitch, Math.max(0, this.beatAt(p)), this.step, []);
      if (note) this.startDrag(p, { kind: 'drawFree', currentId: note.id, lastStart: note.start, lockPitch: pitch });
      return;
    }
    const step = this.stepIndex(p);
    this.startDrag(p, { kind: 'draw', steps: new Map(), lastStep: step, lastPitch: pitch, lockPitch: pitch });
    this.placeDrawn(step, pitch);
  }

  private downKeys(p: Point): void {
    const pitch = this.pitchAt(p);
    if (!isValidPitch(pitch)) return;
    if (this.mods.shift) {
      // Live: Shift-click adds the key track's notes to the selection, or removes them if all selected.
      const ids = this.store.notes.filter((n) => n.pitch === pitch).map((n) => n.id);
      const sel = new Set(this.store.selection);
      const allIn = ids.length > 0 && ids.every((id) => sel.has(id));
      for (const id of ids) {
        if (allIn) sel.delete(id);
        else sel.add(id);
      }
      this.store.setSelection(sel);
    }
    this.startDrag(p, { kind: 'key', pitch, last: p, zooming: false });
    this.audition(pitch);
  }

  /** Double-click on the keys: zoom key tracks to the selected notes, or all notes (Live). */
  private fitKeys(): void {
    const notes = this.store.selection.size ? this.store.selectedNotes() : this.store.notes;
    if (!notes.length) return;
    const { lo, hi } = noteBounds(notes);
    this.vp.fitPitches(lo, hi);
  }

  private downVelocity(p: Point): void {
    const { store } = this;
    const stem = this.mods.meta ? null : this.stemAt(p);
    if (this.mods.meta || (!store.drawMode && !stem)) {
      const beat = this.beatAt(p);
      const v = this.layout.yToVelocity(p.y);
      this.overlay.velocityRamp = { b0: beat, v0: v, b1: beat, v1: v };
      this.startDrag(p, { kind: 'velocityRamp', base: store.notes, ids: store.selection.size ? new Set(store.selection) : null });
      return;
    }
    if (store.drawMode) {
      store.checkpoint();
      this.startDrag(p, { kind: 'velocityPaint', lastX: p.x });
      this.paintVelocity(p.x, p.x, p.y);
      return;
    }
    const n = stem;
    if (!n) return;
    if (!store.selection.has(n.id)) store.setSelection(this.mods.shift ? [...store.selection, n.id] : [n.id]);
    this.overlay.velocityNote = n.id;
    this.startDrag(p, { kind: 'velocity', anchor: n, ids: new Set(store.selection), base: store.notes });
  }

  // ------------------------------------------------------------ pointer move

  private onMove(e: PointerEvent): void {
    if (this.store.view === 'falling') {
      if (this.canvas.style.cursor !== 'pointer') this.canvas.style.cursor = 'pointer';
      return;
    }
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
      case 'velocityRamp':
        return this.dragVelocityRamp(d, p);
      case 'erase': {
        const h = this.hit(p);
        if (h) this.store.removeNote(h.note.id);
        return;
      }
      case 'scrub':
        return this.scrubTo(p);
      case 'loop':
        return this.dragLoop(d, p);
      case 'rulerZoom':
        if (this.begin(d, p, false)) {
          // Drag down zooms in around the pointer; drag sideways scrolls.
          this.vp.zoomX(Math.exp((p.y - d.last.y) * 0.012), this.layout.toGrid(p).x);
          this.vp.scrollBy(d.last.x - p.x, 0);
        }
        d.last = p;
        return;
      case 'key': {
        // A mostly-horizontal drag zooms key-track height (right = taller), anchored where it began.
        const dx = p.x - d.origin.x;
        if (!d.zooming && Math.abs(dx) > DRAG_THRESHOLD && Math.abs(dx) > Math.abs(p.y - d.origin.y)) {
          d.zooming = true;
          this.cancelPreview();
        }
        if (d.zooming) {
          this.vp.zoomY(Math.exp((p.x - d.last.x) * 0.015), this.layout.toGrid(d.origin).y);
          d.last = p;
          return;
        }
        d.last = p;
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

  private dragMove(d: DragOf<'move'>, p: Point): void {
    if (!this.begin(d, p)) return;
    const vp = this.vp;
    // Content-space delta, so autoscrolling while holding still keeps moving the notes.
    const dx = p.x - d.origin.x + vp.scrollX - d.scroll0.x;
    const dy = p.y - d.origin.y + vp.scrollY - d.scroll0.y;
    const y0 = d.origin.y + d.scroll0.y;
    let dBeat = this.snap(d.anchor.start + dx / vp.pxPerBeat) - d.anchor.start;
    let dPitch = Math.floor(y0 / vp.rowHeight) - Math.floor((y0 + dy) / vp.rowHeight);
    dBeat = Math.max(-d.bounds.start, dBeat);
    dPitch = Math.max(MIN_PITCH - d.bounds.lo, Math.min(MAX_PITCH - d.bounds.hi, dPitch));

    const shift = (n: Note, id = n.id): Note => ({ ...n, id, start: n.start + dBeat, pitch: n.pitch + dPitch });
    if (this.mods.alt) {
      // Option-drag copies; it can be toggled mid-drag.
      const copies = d.moving.map((n) => shift(n, d.copyIds.get(n.id)!));
      this.store.setNotes([...d.base, ...copies], copies.map((n) => n.id));
    } else {
      this.store.setNotes(d.base.map((n) => (d.ids.has(n.id) ? shift(n) : n)), d.ids);
    }
    // Hear the note wherever it lands: on a new pitch or a new spot in time.
    const pitch = d.anchor.pitch + dPitch;
    if (pitch !== d.lastPitch || Math.abs(dBeat - d.lastBeat) > EPS) {
      d.lastPitch = pitch;
      d.lastBeat = dBeat;
      this.audition(pitch, true);
    }
  }

  private dragResize(d: DragOf<'resize'>, p: Point): void {
    if (!this.begin(d, p)) return;
    const rawBeat = (p.x - d.origin.x + this.vp.scrollX - d.scroll0) / this.vp.pxPerBeat;
    const snapping = this.snapping();
    const minDur = (n: Note) => (snapping ? Math.min(this.step, n.duration) : 1 / 128);
    const edgeOf = d.edge === 'end' ? noteEnd : (n: Note) => n.start;
    const delta = this.snap(edgeOf(d.anchor) + rawBeat) - edgeOf(d.anchor);

    this.store.setNotes(
      d.base.map((n) => {
        if (!d.ids.has(n.id)) return n;
        if (d.edge === 'end') return { ...n, duration: Math.max(minDur(n), n.duration + delta) };
        const end = noteEnd(n);
        const start = Math.max(0, Math.min(end - minDur(n), n.start + delta));
        return { ...n, start, duration: end - start };
      }),
    );
  }

  private dragMarquee(d: DragOf<'marquee'>, p: Point): void {
    const m = this.overlay.marquee!;
    const c = this.content(p);
    m.x1 = c.x;
    m.y1 = c.y;
    const vp = this.vp;
    const b0 = Math.min(m.x0, m.x1) / vp.pxPerBeat;
    const b1 = Math.max(m.x0, m.x1) / vp.pxPerBeat;
    const pTop = vp.yToPitch(Math.min(m.y0, m.y1) - vp.scrollY);
    const pBottom = vp.yToPitch(Math.max(m.y0, m.y1) - vp.scrollY);
    const hits = this.store.notes
      .filter((n) => n.pitch <= pTop && n.pitch >= pBottom && n.start < b1 && noteEnd(n) > b0)
      .map((n) => n.id);
    this.store.setSelection(d.additive ? new Set([...d.baseSel, ...hits]) : hits);
  }

  private dragVelocity(d: DragOf<'velocity'>, p: Point): void {
    if (!this.begin(d, p)) return;
    // The grabbed stem follows the mouse; other selected notes move by the same amount.
    const delta = this.layout.yToVelocity(p.y) - d.anchor.velocity;
    this.store.setNotes(d.base.map((n) => (d.ids.has(n.id) ? { ...n, velocity: clampVelocity(n.velocity + delta) } : n)));
  }

  /** A straight velocity line from where the drag began: notes starting under it take its value. */
  private dragVelocityRamp(d: DragOf<'velocityRamp'>, p: Point): void {
    const ramp = this.overlay.velocityRamp;
    if (!ramp || !this.begin(d, p)) return;
    ramp.b1 = this.beatAt(p);
    ramp.v1 = this.layout.yToVelocity(p.y);
    const { b0, v0, b1, v1 } = ramp;
    const lo = Math.min(b0, b1);
    const hi = Math.max(b0, b1);
    this.store.setNotes(
      d.base.map((n) => {
        if ((d.ids && !d.ids.has(n.id)) || n.start < lo || n.start > hi) return n;
        const t = hi > lo ? (n.start - b0) / (b1 - b0) : 1;
        return { ...n, velocity: clampVelocity(v0 + (v1 - v0) * t) };
      }),
    );
  }

  /** Draw-mode sweep: every note whose start lies between the last and current x gets this velocity. */
  private paintVelocity(x0: number, x1: number, y: number): void {
    const lo = Math.min(x0, x1) - 3;
    const hi = Math.max(x0, x1) + 3;
    const v = this.layout.yToVelocity(y);
    let changed = false;
    const notes = this.store.notes.map((n) => {
      const x = this.xOf(n.start);
      if (x < lo || x > hi || n.velocity === v) return n;
      changed = true;
      return { ...n, velocity: v };
    });
    if (changed) this.store.setNotes(notes);
  }

  // ------------------------------------------------------------ drawing

  private stepIndex(p: Point): number {
    return Math.floor(this.beatAt(p) / this.step + EPS);
  }

  /** Add a drawn note unless that spot is taken; selects it alongside `selection`. */
  private addDrawn(pitch: number, start: number, len: number, selection: Iterable<number>): Note | null {
    if (this.occupied(pitch, start, len)) return null;
    const note = this.store.makeNote(pitch, start, len);
    this.store.appendNotes([note], [...selection, note.id]);
    this.audition(pitch, true); // every new note sounds, even at the same pitch
    return note;
  }

  /** Move a just-drawn note to another pitch, unless that spot is taken. */
  private repitch(id: number, pitch: number): void {
    const cur = this.store.notes.find((n) => n.id === id);
    if (!cur || cur.pitch === pitch || this.occupied(pitch, cur.start, cur.duration, id)) return;
    this.store.updateNote(id, { pitch });
    this.audition(pitch);
  }

  private dragDraw(d: DragOf<'draw'>, p: Point): void {
    const s = this.stepIndex(p);
    const target = this.mods.alt ? d.lockPitch : clampPitch(this.pitchAt(p));
    if (s === d.lastStep) {
      this.placeDrawn(s, target);
    } else {
      // Fill skipped steps when the mouse moves fast, interpolating pitch.
      const dir = Math.sign(s - d.lastStep);
      const span = Math.abs(s - d.lastStep);
      for (let i = 1; i <= span; i++) {
        this.placeDrawn(d.lastStep + dir * i, Math.round(d.lastPitch + ((target - d.lastPitch) * i) / span));
      }
    }
    d.lastStep = s;
    d.lastPitch = target;
  }

  /** One drawn note per grid step; moving vertically within a step re-pitches it. */
  private placeDrawn(stepIdx: number, pitch: number): void {
    const d = this.drag;
    if (d?.kind !== 'draw' || stepIdx < 0) return;
    const existing = d.steps.get(stepIdx);
    if (existing !== undefined) return this.repitch(existing, pitch);
    const note = this.addDrawn(pitch, stepIdx * this.step, this.step, d.steps.values());
    if (note) d.steps.set(stepIdx, note.id);
  }

  /** Boneless painting: a new note each time the mouse travels one note-length; otherwise re-pitch. */
  private dragDrawFree(d: DragOf<'drawFree'>, p: Point): void {
    const beat = Math.max(0, this.beatAt(p));
    const pitch = this.mods.alt ? d.lockPitch : clampPitch(this.pitchAt(p));
    if (Math.abs(beat - d.lastStart) < this.step) return this.repitch(d.currentId, pitch);
    const note = this.addDrawn(pitch, beat, this.step, this.store.selection);
    if (note) {
      d.currentId = note.id;
      d.lastStart = beat;
    }
  }

  // ------------------------------------------------------------ ruler

  private loopZone(p: Point): LoopZone {
    const { start, end } = this.store.loop;
    const x0 = this.xOf(start);
    const x1 = this.xOf(end);
    const edge = Math.min(6, (x1 - x0) / 3);
    if (Math.abs(p.x - x0) <= edge) return 'start';
    if (Math.abs(p.x - x1) <= edge) return 'end';
    return p.x > x0 && p.x < x1 ? 'move' : 'new';
  }

  private dragLoop(d: DragOf<'loop'>, p: Point): void {
    if (!this.begin(d, p, false)) return;
    const min = this.snapping() ? this.step : 1 / 64;
    const at = (b: number) => Math.max(0, this.snap(b));
    const beat = this.beatAt(p);
    const { base } = d;
    switch (d.mode) {
      case 'move': {
        const start = at(base.start + beat - d.originBeat);
        return this.store.setLoop({ start, end: start + base.end - base.start });
      }
      case 'start':
        return this.store.setLoop({ start: Math.min(at(beat), base.end - min) });
      case 'end':
        return this.store.setLoop({ end: Math.max(at(beat), base.start + min) });
      case 'new': {
        const a = at(d.originBeat);
        const b = at(beat);
        if (Math.abs(b - a) >= min - EPS) this.store.setLoop({ start: Math.min(a, b), end: Math.max(a, b), enabled: true });
      }
    }
  }

  private scrubTo(p: Point): void {
    const beat = Math.max(0, this.snap(this.beatAt(p)));
    if (Math.abs(beat - this.store.position) > EPS || !this.store.playing) this.transport.seek(beat);
  }

  // ------------------------------------------------------------ pointer up

  private onUp(e: PointerEvent): void {
    const d = this.drag;
    this.drag = null;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (d && !d.started) {
      // Plain clicks.
      if (d.kind === 'move' && d.selectOnlyOnClick !== null) this.store.setSelection([d.selectOnlyOnClick]);
      if (d.kind === 'rulerZoom') this.scrubTo(d.origin);
      // Clicking the brace switches the loop on/off, as in Live.
      if (d.kind === 'loop' && d.mode !== 'new') this.store.setLoop({ enabled: !this.store.loop.enabled });
    }
    this.overlay.marquee = null;
    this.overlay.velocityRamp = null;
    this.cancelPreview(true); // let a quick drag's note ring out instead of clipping it
    const p = this.local(e);
    this.hover(p);
    this.updateCursor(p);
    this.invalidate();
  }

  // ------------------------------------------------------------ hover & cursor

  private hover(p: Point): void {
    const o = this.overlay;
    const region = this.region(p);
    o.hoverNote = null;
    o.ghost = null;
    o.hoverPitch = null;
    this.hoverZone = null;
    o.velocityNote = region === 'velocity' && !this.store.drawMode ? (this.stemAt(p)?.id ?? null) : null;
    if (region === 'grid' || region === 'keys') {
      const pitch = this.pitchAt(p);
      if (isValidPitch(pitch)) o.hoverPitch = pitch;
    }
    if (region !== 'grid' || o.hoverPitch === null) return;
    const h = this.hit(p);
    if (h) {
      o.hoverNote = h.note.id;
      this.hoverZone = h.zone;
    } else if (this.store.drawMode) {
      o.ghost = { pitch: o.hoverPitch, start: Math.max(0, this.snap(this.beatAt(p), 'floor')), duration: this.step };
    }
  }

  private clearHover(): void {
    const o = this.overlay;
    o.hoverNote = o.ghost = o.hoverPitch = o.velocityNote = null;
    this.hoverZone = null;
    this.invalidate();
  }

  private dragCursor(d: Drag): string {
    switch (d.kind) {
      case 'resize':
        return 'ew-resize';
      case 'move':
        return d.started ? (this.mods.alt ? 'copy' : 'grabbing') : 'default';
      case 'draw':
      case 'drawFree':
      case 'erase':
      case 'velocityPaint':
      case 'velocityRamp':
        return PENCIL_CURSOR;
      case 'velocity':
        return 'ns-resize';
      case 'key':
        return d.zooming ? 'ew-resize' : 'pointer';
      case 'rulerZoom':
        return 'zoom-in';
      case 'scrub':
        return 'col-resize';
      case 'loop':
        return d.mode === 'move' ? 'grabbing' : d.mode === 'new' ? 'crosshair' : 'ew-resize';
      default:
        return 'default';
    }
  }

  private hoverCursor(p: Point): string {
    switch (this.region(p)) {
      case 'grid':
        if (this.hoverZone === 'start' || this.hoverZone === 'end') return 'ew-resize';
        return this.store.drawMode ? PENCIL_CURSOR : 'default';
      case 'loop': {
        const z = this.loopZone(p);
        return z === 'start' || z === 'end' ? 'ew-resize' : z === 'move' ? 'grab' : 'crosshair';
      }
      case 'scrub':
      case 'keys':
        return 'pointer';
      case 'beat':
        return 'zoom-in';
      case 'velocity':
        if (this.store.drawMode || this.mods.meta) return PENCIL_CURSOR;
        return this.overlay.velocityNote !== null ? 'ns-resize' : 'crosshair';
      default:
        return 'default';
    }
  }

  private updateCursor(p: Point): void {
    const cursor = this.drag ? this.dragCursor(this.drag) : this.hoverCursor(p);
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
    if (this.store.view === 'falling') return;
    const p = this.local(e);
    const g = this.layout.toGrid(p);
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.vp.height : 1;
    let dx = e.deltaX * unit;
    let dy = e.deltaY * unit;
    const clampDelta = (v: number) => Math.max(-60, Math.min(60, v));

    if (e.ctrlKey || e.metaKey) {
      // Trackpad pinch arrives as ctrl+wheel; Cmd+wheel zooms time, as in Live.
      const k = e.ctrlKey && !e.metaKey ? 0.012 : 0.004;
      this.vp.zoomX(Math.exp(-clampDelta(dy) * k), Math.max(0, g.x));
    } else if (e.altKey) {
      this.vp.zoomY(Math.exp(-clampDelta(dy) * 0.006), Math.max(0, g.y));
    } else {
      if (e.shiftKey && dx === 0) [dx, dy] = [dy, 0];
      this.vp.scrollBy(dx, dy);
    }
    if (this.drag) this.dragTo(p);
  }

  /** Called every frame: scroll when dragging past the grid edges. */
  autoscroll(): void {
    const d = this.drag;
    if (!d || !AUTOSCROLLING.has(d.kind)) return;
    const vp = this.vp;
    const g = this.layout.toGrid(this.last);
    const speed = (over: number) => Math.sign(over) * Math.min(AUTOSCROLL_MAX, Math.abs(over) * 0.35);
    const dx = g.x < 0 ? speed(g.x) : g.x > vp.width ? speed(g.x - vp.width) : 0;
    const dy = g.y < 0 ? speed(g.y) : g.y > vp.height ? speed(g.y - vp.height) : 0;
    if (!dx && !dy) return;
    const sx = vp.scrollX;
    const sy = vp.scrollY;
    vp.scrollBy(dx, dy);
    if (vp.scrollX !== sx || vp.scrollY !== sy) this.dragTo(this.last);
  }
}
