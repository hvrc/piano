// Draws the whole piano roll onto one canvas: grid, notes, overlays, ruler, keyboard, velocity.
// Everything is derived from musical data via the Viewport and Layout; pixels are never stored.
import type { Note } from '../model/note';
import { noteEnd } from '../model/note';
import { isBlackKey, pitchName, MAX_PITCH, MIN_PITCH } from '../music/pitch';
import { KEYBOARD_SPAN, type Store } from '../state/store';
import { BEATS_PER_BAR, gridStep, isMultiple } from '../timeline/grid';
import type { Viewport } from '../timeline/viewport';
import { BEAT_H, KEYS_W, LABEL_W, LOOP_H, RULER_H, SCRUB_H, VEL_H, type Layout } from './layout';
import type { Overlay } from './overlay';
import { C, FONT, noteFill } from './theme';

const TICKS_H = SCRUB_H + BEAT_H; // ruler height below the loop lane

export class Renderer {
  private g: CanvasRenderingContext2D;
  private dpr = 1;
  /** Notes overlapping the visible beat range this frame: unselected first, then selected. */
  private visible: Note[] = [];
  private labelWidths = new Map<string, number>();

  constructor(
    private canvas: HTMLCanvasElement,
    private store: Store,
    private vp: Viewport,
    private layout: Layout,
    private overlay: Overlay,
    private playheadBeat: () => number,
  ) {
    this.g = canvas.getContext('2d', { alpha: false })!;
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
    g.fillStyle = C.bg;
    g.fillRect(0, 0, layout.width, layout.height);

    this.collectVisible();
    this.drawGrid();
    this.drawNotes();
    this.drawGridOverlays();
    this.drawRuler();
    this.drawKeys(this.activePitches());
    this.drawVelocity();
    this.drawCorner();
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

  private activePitches(): Set<number> {
    const set = new Set([...this.overlay.pressedKeys, ...this.overlay.heldKeys]);
    if (this.store.playing) {
      const b = this.playheadBeat();
      for (const n of this.store.notes) if (b >= n.start && b < noteEnd(n)) set.add(n.pitch);
    }
    return set;
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

  /** Visit grid-step lines in view that aren't beat lines. */
  private forSubBeats(step: number, fn: (x: number) => void): void {
    const [b0, b1] = this.visibleBeats();
    for (let k = Math.floor(b0 / step); k * step <= b1; k++) {
      if (!isMultiple(k * step, 1)) fn(this.vp.beatToX(k * step));
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

      const top = Math.max(0, vp.pitchToY(MAX_PITCH));
      const h = Math.min(vp.height, vp.pitchToY(MIN_PITCH) + rh) - top;
      const step = gridStep(store.grid);
      if (step < 1 && step * vp.pxPerBeat >= 6) this.forSubBeats(step, (x) => this.vline(x, top, h, C.lineSub));
      if (vp.pxPerBeat >= 8) this.forBeats((x) => this.vline(x, top, h, C.lineBeat));
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
    const font = `600 ${Math.min(11, rh - 4)}px ${FONT}`;
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

        if (selected && h >= 7) {
          // Live draws selected notes with a light outline around a dark inner edge.
          g.fillStyle = C.noteSelectedOutline;
          g.fillRect(x, y, w, h);
          g.fillStyle = C.noteSelectedInner;
          g.fillRect(x + 1, y + 1, w - 2, h - 2);
          g.fillStyle = hovered ? C.noteSelectedHover : C.noteSelected;
          g.fillRect(x + 2, y + 2, w - 4, h - 4);
        } else {
          g.fillStyle = C.noteBorder;
          g.fillRect(x, y, w, h);
          g.fillStyle = selected ? C.noteSelected : noteFill(n.velocity, hovered);
          g.fillRect(x + 1, y + 1, w - 2, h - 2);
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
        g.fillStyle = C.ghost;
        g.fillRect(Math.round(vp.beatToX(start)), vp.pitchToY(pitch), Math.max(3, Math.round(duration * vp.pxPerBeat)), rh - 1);
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
        g.font = `500 13px ${FONT}`;
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
      g.fillStyle = C.divider;
      g.fillRect(0, TICKS_H - 1, vp.width, 1);

      const ppb = vp.pxPerBeat;
      const base = TICKS_H - 1;
      const step = gridStep(store.grid);
      if (step < 1 && step * ppb >= 8) this.forSubBeats(step, (x) => this.vline(x, base - 3, 3, C.rulerTick));
      if (ppb >= 8) this.forBeats((x) => this.vline(x, base - 6, 6, C.rulerTick));

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
    const w = Math.max(4, x1 - x0);
    // The brace: a bar with downward hooks at both ends, like Live's.
    g.fillStyle = loop.enabled ? C.loopOn : C.loopOff;
    g.fillRect(x0, 2, w, LOOP_H - 5);
    g.fillRect(x0, 2, 2, LOOP_H - 2);
    g.fillRect(x0 + w - 2, 2, 2, LOOP_H - 2);
    g.fillStyle = loop.enabled ? C.loopOnEdge : C.loopOffEdge;
    g.fillRect(x0, 2, w, 1);
  }

  // ---------------------------------------------------------------- velocity lane

  private drawVelocity(): void {
    const { g, vp, store, overlay, layout } = this;
    const top = layout.velocityTop;

    // Label column on the left.
    g.fillStyle = C.labelColumn;
    g.fillRect(0, top, KEYS_W, VEL_H);
    g.fillStyle = C.velLabel;
    g.font = `500 10px ${FONT}`;
    g.textBaseline = 'middle';
    g.fillText('Velocity', 6, top + VEL_H / 2);
    g.textAlign = 'right';
    g.fillText('127', KEYS_W - 6, layout.velocityToY(127));
    g.fillText('1', KEYS_W - 6, layout.velocityToY(1));
    g.textAlign = 'left';
    g.fillStyle = C.divider;
    g.fillRect(0, top, KEYS_W, 1);
    g.fillRect(KEYS_W - 1, top, 1, VEL_H);

    // The lane itself, drawn in canvas y (only x is shifted to the grid).
    this.clipped(KEYS_W, top, vp.width, VEL_H, () => {
      g.translate(KEYS_W, 0);
      g.fillStyle = C.velLane;
      g.fillRect(0, top, vp.width, VEL_H);
      g.fillStyle = C.velGuide;
      for (const v of [32, 64, 96, 127]) g.fillRect(0, Math.round(layout.velocityToY(v)), vp.width, 1);
      this.forBars(this.barSkip(8), (x) => this.vline(x, top, VEL_H, C.velGuide));

      const base = layout.velocityToY(0);
      for (const n of this.visible) {
        const selected = store.selection.has(n.id);
        const x = Math.round(vp.beatToX(n.start)) + 0.5;
        const y = layout.velocityToY(n.velocity);
        const hot = overlay.velocityNote === n.id;
        // Stem, a faint bar across the note's length, and a round head (Live's velocity editor).
        g.fillStyle = selected ? C.noteSelected : noteFill(n.velocity, hot);
        g.fillRect(x - 0.5, y, hot ? 2 : 1, base - y);
        g.globalAlpha = 0.35;
        g.fillRect(x, Math.round(y) - 1, Math.max(0, n.duration * vp.pxPerBeat - 2), 2);
        g.globalAlpha = 1;
        g.beginPath();
        g.arc(x, y, hot ? 4 : 3, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = selected ? C.noteSelectedOutline : C.noteBorder;
        g.lineWidth = 1;
        g.stroke();
        if (hot) {
          g.fillStyle = C.velValue;
          g.font = `600 10px ${FONT}`;
          g.fillText(String(n.velocity), x + 7, Math.max(top + 8, y));
        }
      }

      const px = this.playheadX();
      if (px !== null) this.vline(px, top, VEL_H, this.playheadColor);
      g.fillStyle = C.divider;
      g.fillRect(0, top, vp.width, 1);
    }, false);
  }

  // ---------------------------------------------------------------- keyboard

  private drawKeys(active: Set<number>): void {
    const { g, vp, overlay } = this;
    const rh = vp.rowHeight;
    this.clipped(0, RULER_H, KEYS_W, vp.height, () => {
      g.fillStyle = C.labelColumn;
      g.fillRect(0, 0, LABEL_W, vp.height);
      g.fillStyle = C.bg;
      g.fillRect(LABEL_W, 0, KEYS_W - LABEL_W, vp.height);

      // Live's piano ruler: one full-width key per row, names in a column to the left.
      const kb = this.store.keyboard;
      const kx = LABEL_W + 1;
      const kw = KEYS_W - LABEL_W - 2;
      const [lo, hi] = this.visiblePitches();
      g.font = `500 ${Math.max(9, Math.min(11, rh - 3))}px ${FONT}`;
      g.textBaseline = 'middle';

      for (let p = lo; p <= hi; p++) {
        const y = vp.pitchToY(p);
        const black = isBlackKey(p);
        const hover = overlay.hoverPitch === p;
        const lit = active.has(p);
        g.fillStyle = lit
          ? black ? C.keyActiveBlack : C.keyActive
          : black ? (hover ? C.keyBlackHover : C.keyBlack) : hover ? C.keyWhiteHover : C.keyWhite;
        g.fillRect(kx, y, kw, rh);
        if (p % 12 === 0 || p % 12 === 5) {
          g.fillStyle = C.keyWhiteLine;
          g.fillRect(kx, y + rh - 1, kw, 1);
        }
        if (kb.enabled && p >= kb.base && p <= kb.base + KEYBOARD_SPAN) {
          // Mark the range the computer keyboard plays, as Live does.
          g.fillStyle = C.keyboardRange;
          g.fillRect(LABEL_W - 3, y, 3, rh);
        }
        if ((p % 12 === 0 && rh >= 9) || hover) {
          g.fillStyle = hover ? C.labelHover : C.label;
          g.fillText(pitchName(p), 4, y + rh / 2);
        }
      }
      g.fillStyle = C.labelDivider;
      g.fillRect(LABEL_W, 0, 1, vp.height);
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
