// Draws the whole piano roll onto one canvas: grid, notes, overlays, ruler, keyboard, velocity.
// Everything is derived from musical data via the Viewport and Layout; pixels are never stored.
import type { Note } from '../model/note';
import { noteEnd } from '../model/note';
import { isBlackKey, pitchName, MAX_PITCH, MIN_PITCH } from '../music/pitch';
import { KEYBOARD_SPAN, type Store } from '../state/store';
import { BEATS_PER_BAR, gridStep, isMultiple } from '../timeline/grid';
import type { Viewport } from '../timeline/viewport';
import { BEAT_H, KEYS_W, LOOP_H, PANEL_RADIUS, RULER_H, SCRUB_H, VEL_H, type Layout } from './layout';
import type { Overlay } from './overlay';
import { C, FONT, noteFill, paperGrain, SERIF } from './theme';

const TICKS_H = SCRUB_H + BEAT_H; // ruler height below the loop lane
const KEY_GLOW_FLOOR = 0.12; // a held note never fades out completely

export class Renderer {
  private g: CanvasRenderingContext2D;
  private dpr = 1;
  /** Notes overlapping the visible beat range this frame: unselected first, then selected. */
  private visible: Note[] = [];
  private labelWidths = new Map<string, number>();
  private grain: CanvasPattern | null;

  constructor(
    private canvas: HTMLCanvasElement,
    private store: Store,
    private vp: Viewport,
    private layout: Layout,
    private overlay: Overlay,
    private playheadBeat: () => number,
  ) {
    // Transparent outside the panels, so the real page (and its grain) shows through the gaps and corners.
    this.g = canvas.getContext('2d')!;
    this.grain = this.g.createPattern(paperGrain(), 'repeat');
  }

  /** Text widths were measured with a fallback font until the web fonts finished loading. */
  fontsLoaded(): void {
    this.labelWidths.clear();
  }

  /** After the canvas palette changes: rebuild the paper grain in the new ink. */
  retheme(): void {
    this.grain = this.g.createPattern(paperGrain(), 'repeat');
  }

  resize(): void {
    const parent = this.canvas.parentElement!;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.layout.resize(w, h);
    this.vp.setSize(this.layout.gridWidth, this.layout.gridHeight);
  }

  render(): void {
    const { g, layout } = this;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // Two rounded panels (the roll, and the velocity lane) on a transparent canvas.
    g.clearRect(0, 0, layout.width, layout.height);
    this.collectVisible();

    this.inPanel(0, layout.rollHeight, () => {
      g.fillStyle = C.bg;
      g.fillRect(0, 0, layout.width, layout.rollHeight);
      this.drawGrid();
      this.drawNotes();
      this.drawGridOverlays();
      this.drawRuler();
      this.drawKeys(this.keyGlow());
      this.drawCorner();
    });
    this.inPanel(layout.velocityTop, VEL_H, () => this.drawVelocity());
    // Last and unclipped: the handwritten dynamics' swashes go in front of everything.
    this.drawDynamics();
  }

  /** ff / mf / pp beside the velocity lane: a little musical twist on Live's 1–127 scale. */
  private drawDynamics(): void {
    const { g, layout } = this;
    g.fillStyle = C.velLabel;
    g.font = `19px ${SERIF}`;
    g.textBaseline = 'middle';
    g.textAlign = 'right';
    g.fillText('ff', KEYS_W - 8, layout.velocityToY(118));
    g.fillText('mf', KEYS_W - 8, layout.velocityToY(72));
    g.fillText('pp', KEYS_W - 8, layout.velocityToY(22));
    g.textAlign = 'left';
  }

  /** Clip drawing to a full-width panel with rounded corners. */
  private inPanel(y: number, h: number, draw: () => void): void {
    const g = this.g;
    g.save();
    g.beginPath();
    g.roundRect(0, y, this.layout.width, h, PANEL_RADIUS);
    g.clip();
    draw();
    g.restore();
  }

  // ---------------------------------------------------------------- helpers

  private collectVisible(): void {
    const [b0, b1] = this.visibleBeats();
    const sel = this.store.selection;
    const unselected: Note[] = [];
    const selected: Note[] = [];
    for (const n of this.store.notes) {
      if (n.start > b1 || noteEnd(n) < b0) continue;
      (sel.has(n.id) ? selected : unselected).push(n);
    }
    this.visible = unselected.concat(selected);
  }

  private visibleBeats(): [number, number] {
    return [this.vp.xToBeat(0), this.vp.xToBeat(this.vp.width)];
  }

  private visiblePitches(): [number, number] {
    const top = Math.min(MAX_PITCH, this.vp.yToPitch(0));
    const bottom = Math.max(MIN_PITCH, this.vp.yToPitch(this.vp.height - 1));
    return [bottom, top];
  }

  /**
   * How lit each key is (0–1). Keys you play by hand stay fully lit while held. During playback a
   * key lights up when its note starts (louder = brighter) and then fades like the piano's sound,
   * slower in the bass; striking the same note again lights it up fully again.
   */
  private keyGlow(): Map<number, number> {
    const glow = new Map<number, number>();
    for (const p of this.overlay.pressedKeys) glow.set(p, 1);
    for (const p of this.overlay.heldKeys) glow.set(p, 1);
    if (!this.store.playing) return glow;
    const b = this.playheadBeat();
    const secPerBeat = 60 / this.store.bpm;
    const latest = new Map<number, { start: number; velocity: number }>(); // most recent onset per pitch
    for (const n of this.store.notes) {
      if (b < n.start || b >= noteEnd(n)) continue;
      const cur = latest.get(n.pitch);
      if (!cur || n.start > cur.start) latest.set(n.pitch, n);
    }
    for (const [pitch, n] of latest) {
      const elapsed = (b - n.start) * secPerBeat;
      const decay = Math.max(0.4, Math.min(2.5, 1.2 * Math.pow(2, -(pitch - 60) / 24))); // seconds
      const peak = 0.55 + 0.45 * (n.velocity / 127);
      const level = Math.max(KEY_GLOW_FLOOR, peak * Math.exp(-elapsed / decay));
      glow.set(pitch, Math.max(glow.get(pitch) ?? 0, level));
    }
    return glow;
  }

  /** Draw inside a clipped rectangle, optionally with its top-left as the origin. */
  private clipped(x: number, y: number, w: number, h: number, draw: () => void, translate = true): void {
    const g = this.g;
    g.save();
    g.beginPath();
    g.rect(x, y, w, h);
    g.clip();
    if (translate) g.translate(x, y);
    draw();
    g.restore();
  }

  private vline(x: number, y: number, h: number, color: string): void {
    this.g.fillStyle = color;
    this.g.fillRect(Math.round(x), y, 1, h);
  }

  /** A dotted pen line, like the ledger rules on the reference paper. */
  private dotted(x: number, y: number, h: number, color: string, gap = 2): void {
    const g = this.g;
    g.strokeStyle = color;
    g.lineWidth = 1;
    g.setLineDash([1, gap]);
    g.beginPath();
    g.moveTo(Math.round(x) + 0.5, y);
    g.lineTo(Math.round(x) + 0.5, y + h);
    g.stroke();
    g.setLineDash([]);
  }

  private paper(w: number, h: number, y = 0): void {
    if (!this.grain) return;
    this.g.fillStyle = this.grain;
    this.g.fillRect(0, y, w, h);
  }

  /** Smallest power-of-two bar spacing that keeps marks at least minPx apart. */
  private barSkip(minPx: number): number {
    let n = 1;
    while (n * BEATS_PER_BAR * this.vp.pxPerBeat < minPx) n *= 2;
    return n;
  }

  /** Visit every `every`-th bar line in view. */
  private forBars(every: number, fn: (x: number, bar: number) => void): void {
    const [b0, b1] = this.visibleBeats();
    for (let bar = Math.floor(b0 / BEATS_PER_BAR); bar * BEATS_PER_BAR <= b1; bar++) {
      if (bar % every === 0) fn(this.vp.beatToX(bar * BEATS_PER_BAR), bar);
    }
  }

  /** Visit beat lines in view that aren't bar lines. */
  private forBeats(fn: (x: number, beat: number) => void): void {
    const [b0, b1] = this.visibleBeats();
    for (let b = Math.floor(b0); b <= b1; b++) if (b % BEATS_PER_BAR !== 0) fn(this.vp.beatToX(b), b);
  }

  /**
   * Visit the grid lines in view (bar lines excluded; they're drawn separately). Lines follow the
   * grid step exactly — 1 Bar shows no beat lines, triplets show triplet lines. When the step is
   * too dense to draw at this zoom, fall back to beat lines, but only if beats lie on the grid.
   */
  private forGridLines(step: number, minPx: number, fn: (x: number, onBeat: boolean) => void): void {
    const [b0, b1] = this.visibleBeats();
    const ppb = this.vp.pxPerBeat;
    let unit = step;
    if (step * ppb < minPx) {
      if (!isMultiple(1, step) || ppb < minPx) return; // beats aren't grid lines, or even beats are too dense
      unit = 1;
    }
    for (let k = Math.floor(b0 / unit); k * unit <= b1; k++) {
      const b = k * unit;
      if (!isMultiple(b, BEATS_PER_BAR)) fn(this.vp.beatToX(b), isMultiple(b, 1));
    }
  }

  /** Playhead x inside the grid area, or null when it's off-screen. */
  private playheadX(margin = 1): number | null {
    const x = this.vp.beatToX(this.playheadBeat());
    return x >= -margin && x <= this.vp.width + margin ? x : null;
  }

  private get playheadColor(): string {
    return this.store.playing ? C.playhead : C.insertMarker;
  }

  private labelWidth(font: string, text: string): number {
    const key = `${font}|${text}`;
    let w = this.labelWidths.get(key);
    if (w === undefined) {
      w = this.g.measureText(text).width;
      this.labelWidths.set(key, w);
    }
    return w;
  }

  // ---------------------------------------------------------------- grid

  private drawGrid(): void {
    const { g, vp, overlay, store } = this;
    const rh = vp.rowHeight;
    this.clipped(KEYS_W, RULER_H, vp.width, vp.height, () => {
      const [lo, hi] = this.visiblePitches();
      for (let p = lo; p <= hi; p++) {
        const y = vp.pitchToY(p);
        g.fillStyle = isBlackKey(p) ? C.rowBlack : C.rowWhite;
        g.fillRect(0, y, vp.width, rh);
        if (p === overlay.hoverPitch) {
          g.fillStyle = C.rowHover;
          g.fillRect(0, y, vp.width, rh);
        }
        if (p % 12 === 0 || p % 12 === 5) {
          g.fillStyle = p % 12 === 0 ? C.octaveLine : C.rowLine;
          g.fillRect(0, y + rh - 1, vp.width, 1);
        }
      }

      this.paper(vp.width, vp.height);
      const top = Math.max(0, vp.pitchToY(MAX_PITCH));
      const h = Math.min(vp.height, vp.pitchToY(MIN_PITCH) + rh) - top;
      const step = gridStep(store.grid);
      this.forGridLines(step, 6, (x, onBeat) => this.dotted(x, top, h, onBeat ? C.lineBeat : C.lineSub, onBeat ? 2 : 4));
      this.forBars(this.barSkip(8), (x) => this.vline(x, top, h, C.lineBar));

      // Live greys out everything outside an active loop.
      const loop = store.loop;
      if (loop.enabled) {
        const lx = Math.round(vp.beatToX(loop.start));
        const rx = Math.round(vp.beatToX(loop.end));
        g.fillStyle = C.outsideLoop;
        if (lx > 0) g.fillRect(0, top, lx, h);
        if (rx < vp.width) g.fillRect(rx, top, vp.width - rx, h);
        this.vline(lx, top, h, C.loopLine);
        this.vline(rx, top, h, C.loopLine);
      }
    });
  }

  // ---------------------------------------------------------------- notes

  private drawNotes(): void {
    const { g, vp, store, overlay } = this;
    const rh = vp.rowHeight;
    const [lo, hi] = this.visiblePitches();
    const font = `${Math.min(11, rh - 4)}px ${FONT}`;
    this.clipped(KEYS_W, RULER_H, vp.width, vp.height, () => {
      g.font = font;
      g.textBaseline = 'middle';
      for (const n of this.visible) {
        if (n.pitch < lo || n.pitch > hi) continue;
        const selected = store.selection.has(n.id);
        const x = Math.round(vp.beatToX(n.start));
        const w = Math.max(3, Math.round(vp.beatToX(noteEnd(n))) - x);
        const y = vp.pitchToY(n.pitch);
        const h = rh - 1;
        const hovered = overlay.hoverNote === n.id;

        // Ink slots punched in the roll; the selection is inked in teal.
        const r = Math.min(3, h / 2, w / 2);
        g.beginPath();
        g.roundRect(x, y + 1, w, h - 1, r);
        g.fillStyle = selected ? (hovered ? C.noteSelectedHover : C.noteSelected) : noteFill(n.velocity, hovered);
        g.fill();
        if (selected) {
          g.strokeStyle = C.noteSelectedOutline;
          g.lineWidth = 1;
          g.stroke();
        }

        // The pitch name, only when it fits inside the note.
        if (rh >= 12) {
          const label = pitchName(n.pitch);
          if (this.labelWidth(font, label) + 7 <= w) {
            g.fillStyle = C.noteLabel;
            g.fillText(label, x + 4, y + rh / 2 - 0.5);
          }
        }
      }
    });
  }

  private drawGridOverlays(): void {
    const { g, vp, overlay, store } = this;
    const rh = vp.rowHeight;
    this.clipped(KEYS_W, RULER_H, vp.width, vp.height, () => {
      if (overlay.ghost) {
        const { pitch, start, duration } = overlay.ghost;
        g.strokeStyle = C.ghost;
        g.setLineDash([2, 2]);
        g.beginPath();
        g.roundRect(Math.round(vp.beatToX(start)) + 0.5, vp.pitchToY(pitch) + 1.5, Math.max(3, Math.round(duration * vp.pxPerBeat)) - 1, rh - 3, 3);
        g.stroke();
        g.setLineDash([]);
      }

      if (overlay.marquee) {
        const m = overlay.marquee;
        const x = Math.min(m.x0, m.x1) - vp.scrollX;
        const y = Math.min(m.y0, m.y1) - vp.scrollY;
        const w = Math.abs(m.x1 - m.x0);
        const h = Math.abs(m.y1 - m.y0);
        g.fillStyle = C.marqueeFill;
        g.fillRect(x, y, w, h);
        g.strokeStyle = C.marqueeStroke;
        g.setLineDash([3, 3]);
        g.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));
        g.setLineDash([]);
      }

      if (store.notes.length === 0 && !overlay.ghost) {
        g.fillStyle = C.hint;
        g.font = `24px ${SERIF}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        const hint = store.drawMode
          ? 'Click or drag to draw notes  ·  B to leave draw mode'
          : 'Double-click to add a note  ·  press B to draw';
        g.fillText(hint, vp.width / 2, vp.height / 2);
        g.textAlign = 'left';
      }

      const px = this.playheadX();
      if (px !== null) this.vline(px, 0, vp.height, this.playheadColor);
    });
  }

  // ---------------------------------------------------------------- ruler

  private drawRuler(): void {
    const { g, vp, store } = this;
    this.clipped(KEYS_W, 0, vp.width, RULER_H, () => {
      this.drawLoopLane();
      g.translate(0, LOOP_H);
      g.fillStyle = C.ruler;
      g.fillRect(0, 0, vp.width, TICKS_H);
      g.fillStyle = C.scrub;
      g.fillRect(0, 0, vp.width, SCRUB_H);
      this.paper(vp.width, TICKS_H);
      g.fillStyle = C.divider;
      g.fillRect(0, TICKS_H - 1, vp.width, 1);

      const ppb = vp.pxPerBeat;
      const base = TICKS_H - 1;
      const step = gridStep(store.grid);
      this.forGridLines(step, 8, (x, onBeat) => this.vline(x, base - (onBeat ? 6 : 3), onBeat ? 6 : 3, C.rulerTick));

      // Bars + labels
      g.font = `11px ${FONT}`;
      g.textBaseline = 'middle';
      const labelEvery = this.barSkip(34);
      this.forBars(this.barSkip(8), (x, bar) => {
        const labelled = bar % labelEvery === 0;
        this.vline(x, labelled ? 3 : SCRUB_H, labelled ? TICKS_H - 4 : TICKS_H - SCRUB_H - 1, C.rulerTick);
        if (labelled) {
          g.fillStyle = C.rulerText;
          g.fillText(String(bar + 1), Math.round(x) + 4, SCRUB_H / 2 + 1);
        }
      });
      // Beat labels when zoomed in far enough
      if (ppb >= 64) {
        g.fillStyle = C.rulerTextDim;
        this.forBeats((x, b) => {
          g.fillText(`${Math.floor(b / BEATS_PER_BAR) + 1}.${(b % BEATS_PER_BAR) + 1}`, Math.round(x) + 4, SCRUB_H / 2 + 1);
        });
      }

      // Playhead marker
      const raw = this.playheadX(6);
      if (raw !== null) {
        const px = Math.round(raw);
        g.fillStyle = store.playing ? C.playhead : C.rulerText;
        g.beginPath();
        g.moveTo(px - 5, SCRUB_H - 7);
        g.lineTo(px + 6, SCRUB_H - 7);
        g.lineTo(px + 0.5, SCRUB_H - 1);
        g.closePath();
        g.fill();
        this.vline(px, SCRUB_H - 1, TICKS_H - SCRUB_H, this.playheadColor);
      }
    });
  }

  private drawLoopLane(): void {
    const { g, vp } = this;
    const loop = this.store.loop;
    g.fillStyle = C.loopLane;
    g.fillRect(0, 0, vp.width, LOOP_H);
    const x0 = Math.round(vp.beatToX(loop.start));
    const x1 = Math.round(vp.beatToX(loop.end));
    if (x1 < 0 || x0 > vp.width) return;
    // The brace, drawn like the roll's dotted expression line: a dotted rule with end ticks.
    const w = Math.max(4, x1 - x0);
    const color = loop.enabled ? C.loopOn : C.loopOff;
    g.strokeStyle = color;
    g.lineWidth = 2;
    g.setLineDash([2, 3]);
    g.beginPath();
    g.moveTo(x0, LOOP_H / 2);
    g.lineTo(x0 + w, LOOP_H / 2);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = color;
    g.fillRect(x0, 2, 2, LOOP_H - 4);
    g.fillRect(x0 + w - 2, 2, 2, LOOP_H - 4);
  }

  // ---------------------------------------------------------------- velocity lane

  private drawVelocity(): void {
    const { g, vp, store, overlay, layout } = this;
    const top = layout.velocityTop;

    // Label column on the left.
    g.fillStyle = C.labelColumn;
    g.fillRect(0, top, KEYS_W, VEL_H);
    g.fillStyle = C.divider;
    g.fillRect(KEYS_W - 1, top, 1, VEL_H);

    // The lane itself, drawn in canvas y (only x is shifted to the grid).
    this.clipped(KEYS_W, top, vp.width, VEL_H, () => {
      g.translate(KEYS_W, 0);
      g.fillStyle = C.velLane;
      g.fillRect(0, top, vp.width, VEL_H);
      this.paper(vp.width, VEL_H, top);
      g.strokeStyle = C.velGuide;
      g.setLineDash([1, 3]);
      for (const v of [22, 72, 118]) {
        const y = Math.round(layout.velocityToY(v)) + 0.5;
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(vp.width, y);
        g.stroke();
      }
      g.setLineDash([]);
      this.forBars(this.barSkip(8), (x) => this.vline(x, top, VEL_H, C.velGuide));

      const base = layout.velocityToY(0);
      for (const n of this.visible) {
        const selected = store.selection.has(n.id);
        const x = Math.round(vp.beatToX(n.start)) + 0.5;
        const y = layout.velocityToY(n.velocity);
        const hot = overlay.velocityNote === n.id;
        // An ink stem with an open punch-hole head (Live's velocity editor, on paper).
        const color = selected ? C.noteSelected : noteFill(n.velocity, hot);
        g.fillStyle = color;
        g.fillRect(x - 0.5, y, hot ? 2 : 1, base - y);
        g.globalAlpha = 0.25;
        g.fillRect(x, Math.round(y) - 0.5, Math.max(0, n.duration * vp.pxPerBeat - 2), 1);
        g.globalAlpha = 1;
        g.beginPath();
        g.arc(x, y, hot ? 4 : 3, 0, Math.PI * 2);
        g.fillStyle = C.velLane;
        g.fill();
        g.strokeStyle = color;
        g.lineWidth = selected || hot ? 2 : 1.25;
        g.stroke();
        if (hot) {
          g.fillStyle = C.velValue;
          g.font = `11px ${FONT}`;
          g.fillText(String(n.velocity), x + 7, Math.max(top + 8, y));
        }
      }

      const px = this.playheadX();
      if (px !== null) this.vline(px, top, VEL_H, this.playheadColor);
    }, false);
  }

  // ---------------------------------------------------------------- keyboard

  private drawKeys(glow: Map<number, number>): void {
    const { g, vp, overlay } = this;
    const rh = vp.rowHeight;
    this.clipped(0, RULER_H, KEYS_W, vp.height, () => {
      g.fillStyle = C.bg;
      g.fillRect(0, 0, KEYS_W, vp.height);

      // One full-width key per row (Live's piano ruler), with the note name written on the key.
      const kb = this.store.keyboard;
      const kw = KEYS_W - 1;
      const [lo, hi] = this.visiblePitches();
      g.font = `${Math.max(9, Math.min(11, rh - 4))}px ${FONT}`;
      g.textBaseline = 'middle';
      g.textAlign = 'right';

      for (let p = lo; p <= hi; p++) {
        const y = vp.pitchToY(p);
        const black = isBlackKey(p);
        const hover = overlay.hoverPitch === p;
        const level = glow.get(p) ?? 0;
        const lit = level > 0.5;
        g.fillStyle = black ? (hover ? C.keyBlackHover : C.keyBlack) : hover ? C.keyWhiteHover : C.keyWhite;
        g.fillRect(0, y, kw, rh);
        if (level > 0) {
          // The played colour, faded by how much the note is still ringing.
          g.globalAlpha = level;
          g.fillStyle = black ? C.keyActiveBlack : C.keyActive;
          g.fillRect(0, y, kw, rh);
          g.globalAlpha = 1;
        }
        if (p % 12 === 0 || p % 12 === 5) {
          g.fillStyle = C.keyWhiteLine;
          g.fillRect(0, y + rh - 1, kw, 1);
        }
        if (kb.enabled && p >= kb.base && p <= kb.base + KEYBOARD_SPAN) {
          // Mark the range the computer keyboard plays, as Live does.
          g.fillStyle = C.keyboardRange;
          g.fillRect(0, y, 3, rh);
        }
        if ((p % 12 === 0 && rh >= 9) || hover) {
          g.fillStyle = black || lit ? C.keyNameOnDark : C.keyNameOnLight;
          g.fillText(pitchName(p), kw - 5, y + rh / 2);
        }
      }
      g.textAlign = 'left';
      g.fillStyle = C.keysBorder;
      g.fillRect(KEYS_W - 1, 0, 1, vp.height);
    });
  }

  private drawCorner(): void {
    const g = this.g;
    g.fillStyle = C.ruler;
    g.fillRect(0, 0, KEYS_W, RULER_H);
    g.fillStyle = C.divider;
    g.fillRect(0, RULER_H - 1, KEYS_W, 1);
    g.fillRect(KEYS_W - 1, 0, 1, RULER_H);
  }
}
