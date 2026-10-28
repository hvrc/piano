// Draws the whole piano roll onto one canvas: grid, notes, overlays, ruler, keyboard.
// Everything is derived from musical data via the Viewport; pixels are never stored.
import { isBlackKey, pitchName, MAX_PITCH, MIN_PITCH } from '../music/pitch';
import type { Store } from '../state/store';
import { BEATS_PER_BAR, gridStep, isMultiple } from '../timeline/grid';
import type { Viewport } from '../timeline/viewport';
import { KEYS_W, LABEL_W, LOOP_H, RULER_H, SCRUB_H } from './layout';
import type { Overlay } from './overlay';
import { C, FONT, noteFill } from './theme';
import { KEYBOARD_SPAN } from '../input/computerKeyboard';

const RULER_H_BELOW_LOOP = RULER_H - LOOP_H;

export class Renderer {
  private g: CanvasRenderingContext2D;
  private dpr = 1;
  private cssW = 0;
  private cssH = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private store: Store,
    private vp: Viewport,
    private overlay: Overlay,
    private playheadBeat: () => number,
  ) {
    this.g = canvas.getContext('2d', { alpha: false })!;
  }

  resize(): void {
    const parent = this.canvas.parentElement!;
    this.dpr = window.devicePixelRatio || 1;
    this.cssW = parent.clientWidth;
    this.cssH = parent.clientHeight;
    this.canvas.width = Math.round(this.cssW * this.dpr);
    this.canvas.height = Math.round(this.cssH * this.dpr);
    this.canvas.style.width = `${this.cssW}px`;
    this.canvas.style.height = `${this.cssH}px`;
    this.vp.setSize(this.cssW - KEYS_W, this.cssH - RULER_H);
  }

  render(): void {
    const g = this.g;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = C.bg;
    g.fillRect(0, 0, this.cssW, this.cssH);

    const active = this.activePitches();
    this.drawGrid();
    this.drawNotes();
    this.drawGridOverlays();
    this.drawRuler();
    this.drawKeys(active);
    this.drawCorner();
  }

  // ---------------------------------------------------------------- helpers

  private visiblePitches(): [number, number] {
    const top = Math.min(MAX_PITCH, this.vp.yToPitch(0));
    const bottom = Math.max(MIN_PITCH, this.vp.yToPitch(this.vp.height - 1));
    return [bottom, top];
  }

  private activePitches(): Set<number> {
    const set = new Set([...this.overlay.pressedKeys, ...this.overlay.heldKeys]);
    if (this.store.playing) {
      const b = this.playheadBeat();
      for (const n of this.store.notes) if (b >= n.start && b < n.start + n.duration) set.add(n.pitch);
    }
    return set;
  }

  private clipTo(x: number, y: number, w: number, h: number): void {
    this.g.save();
    this.g.beginPath();
    this.g.rect(x, y, w, h);
    this.g.clip();
    this.g.translate(x, y);
  }

  private vline(x: number, y: number, h: number, color: string): void {
    this.g.fillStyle = color;
    this.g.fillRect(Math.round(x), y, 1, h);
  }

  // ---------------------------------------------------------------- grid

  private drawGrid(): void {
    const { g, vp, overlay } = this;
    const rh = vp.rowHeight;
    this.clipTo(KEYS_W, RULER_H, vp.width, vp.height);

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
    const b0 = vp.xToBeat(0);
    const b1 = vp.xToBeat(vp.width);
    const ppb = vp.pxPerBeat;

    // Sub-beat grid lines
    const step = gridStep(this.store.grid);
    if (step < 1 && step * ppb >= 6) {
      for (let k = Math.floor(b0 / step); k * step <= b1; k++) {
        const b = k * step;
        if (!isMultiple(b, 1)) this.vline(vp.beatToX(b), top, h, C.lineSub);
      }
    }
    // Beat lines
    if (ppb >= 8) {
      for (let b = Math.floor(b0); b <= b1; b++) {
        if (b % BEATS_PER_BAR !== 0) this.vline(vp.beatToX(b), top, h, C.lineBeat);
      }
    }
    // Bar lines (thinned out when zoomed far out)
    const barEvery = this.barSkip(8);
    for (let bar = Math.floor(b0 / BEATS_PER_BAR); bar * BEATS_PER_BAR <= b1; bar++) {
      if (bar % barEvery === 0) this.vline(vp.beatToX(bar * BEATS_PER_BAR), top, h, C.lineBar);
    }

    // Live greys out everything outside an active loop.
    const loop = this.store.loop;
    if (loop.enabled) {
      const lx = Math.round(vp.beatToX(loop.start));
      const rx = Math.round(vp.beatToX(loop.end));
      g.fillStyle = C.outsideLoop;
      if (lx > 0) g.fillRect(0, top, lx, h);
      if (rx < vp.width) g.fillRect(rx, top, vp.width - rx, h);
      this.vline(lx, top, h, C.loopLine);
      this.vline(rx, top, h, C.loopLine);
    }

    g.restore();
  }

  /** Smallest power-of-two bar spacing that keeps marks at least minPx apart. */
  private barSkip(minPx: number): number {
    let n = 1;
    while (n * BEATS_PER_BAR * this.vp.pxPerBeat < minPx) n *= 2;
    return n;
  }

  // ---------------------------------------------------------------- notes

  private drawNotes(): void {
    const { g, vp, store, overlay } = this;
    const rh = vp.rowHeight;
    this.clipTo(KEYS_W, RULER_H, vp.width, vp.height);
    const [lo, hi] = this.visiblePitches();
    const b0 = vp.xToBeat(0);
    const b1 = vp.xToBeat(vp.width);
    g.font = `600 ${Math.min(11, rh - 4)}px ${FONT}`;
    g.textBaseline = 'middle';

    const draw = (selected: boolean) => {
      for (const n of store.notes) {
        if (store.selection.has(n.id) !== selected) continue;
        if (n.pitch < lo || n.pitch > hi || n.start > b1 || n.start + n.duration < b0) continue;
        const x = Math.round(vp.beatToX(n.start));
        const w = Math.max(3, Math.round(vp.beatToX(n.start + n.duration)) - x);
        const y = vp.pitchToY(n.pitch);
        const hovered = overlay.hoverNote === n.id;

        const h = rh - 1;
        if (selected && h >= 7) {
          // Live draws selected notes with a light outline around a dark inner edge.
          g.fillStyle = C.noteSelectedOutline;
          g.fillRect(x, y, w, h);
          g.fillStyle = C.noteSelectedInner;
          g.fillRect(x + 1, y + 1, w - 2, h - 2);
          g.fillStyle = hovered ? '#1db4ea' : C.noteSelected;
          g.fillRect(x + 2, y + 2, w - 4, h - 4);
        } else {
          g.fillStyle = C.noteBorder;
          g.fillRect(x, y, w, h);
          g.fillStyle = selected ? C.noteSelected : noteFill(n.velocity, hovered);
          g.fillRect(x + 1, y + 1, w - 2, h - 2);
        }

        if (w > 26 && rh >= 12) {
          g.save();
          g.beginPath();
          g.rect(x, y, w - 3, rh);
          g.clip();
          g.fillStyle = C.noteLabel;
          g.fillText(pitchName(n.pitch), x + 4, y + rh / 2 - 0.5);
          g.restore();
        }
      }
    };
    draw(false);
    draw(true);
    g.restore();
  }

  private drawGridOverlays(): void {
    const { g, vp, overlay, store } = this;
    const rh = vp.rowHeight;
    this.clipTo(KEYS_W, RULER_H, vp.width, vp.height);

    if (overlay.ghost) {
      const { pitch, start, duration } = overlay.ghost;
      const x = Math.round(vp.beatToX(start));
      g.fillStyle = C.ghost;
      g.fillRect(x, vp.pitchToY(pitch), Math.max(3, Math.round(duration * vp.pxPerBeat)), rh - 1);
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
      g.fillText(
        store.drawMode ? 'Click or drag to draw notes  ·  B to leave draw mode' : 'Double-click to add a note  ·  press B to draw',
        vp.width / 2,
        vp.height / 2,
      );
      g.textAlign = 'left';
    }

    const px = vp.beatToX(this.playheadBeat());
    if (px >= -1 && px <= vp.width + 1) this.vline(px, 0, vp.height, store.playing ? C.playhead : C.insertMarker);
    g.restore();
  }

  // ---------------------------------------------------------------- ruler

  private drawRuler(): void {
    const { g, vp, store } = this;
    this.clipTo(KEYS_W, 0, vp.width, RULER_H);
    this.drawLoopLane();
    g.translate(0, LOOP_H);
    g.fillStyle = C.ruler;
    g.fillRect(0, 0, vp.width, RULER_H_BELOW_LOOP);
    g.fillStyle = C.scrub;
    g.fillRect(0, 0, vp.width, SCRUB_H);
    g.fillStyle = C.divider;
    g.fillRect(0, RULER_H_BELOW_LOOP - 1, vp.width, 1);

    const ppb = vp.pxPerBeat;
    const b0 = vp.xToBeat(0);
    const b1 = vp.xToBeat(vp.width);
    const tickBase = RULER_H_BELOW_LOOP - 1;

    // Sub-beat & beat ticks
    const step = gridStep(store.grid);
    if (step < 1 && step * ppb >= 8) {
      for (let k = Math.floor(b0 / step); k * step <= b1; k++) {
        if (!isMultiple(k * step, 1)) this.vline(vp.beatToX(k * step), tickBase - 3, 3, C.rulerTick);
      }
    }
    if (ppb >= 8) {
      for (let b = Math.floor(b0); b <= b1; b++) {
        if (b % BEATS_PER_BAR !== 0) this.vline(vp.beatToX(b), tickBase - 6, 6, C.rulerTick);
      }
    }

    // Bars + labels
    g.font = `11px ${FONT}`;
    g.textBaseline = 'middle';
    const labelEvery = this.barSkip(34);
    const tickEvery = this.barSkip(8);
    for (let bar = Math.floor(b0 / BEATS_PER_BAR); bar * BEATS_PER_BAR <= b1; bar++) {
      if (bar % tickEvery !== 0) continue;
      const x = vp.beatToX(bar * BEATS_PER_BAR);
      const labelled = bar % labelEvery === 0;
      this.vline(x, labelled ? 3 : SCRUB_H, labelled ? RULER_H_BELOW_LOOP - 4 : RULER_H_BELOW_LOOP - SCRUB_H - 1, C.rulerTick);
      if (labelled) {
        g.fillStyle = C.rulerText;
        g.fillText(String(bar + 1), Math.round(x) + 4, SCRUB_H / 2 + 1);
      }
    }
    // Beat labels when zoomed in far enough
    if (ppb >= 64) {
      g.fillStyle = C.rulerTextDim;
      for (let b = Math.floor(b0); b <= b1; b++) {
        if (b % BEATS_PER_BAR === 0) continue;
        const label = `${Math.floor(b / BEATS_PER_BAR) + 1}.${(b % BEATS_PER_BAR) + 1}`;
        g.fillText(label, Math.round(vp.beatToX(b)) + 4, SCRUB_H / 2 + 1);
      }
    }

    // Playhead marker
    const px = Math.round(vp.beatToX(this.playheadBeat()));
    if (px >= -6 && px <= vp.width + 6) {
      g.fillStyle = store.playing ? C.playhead : C.rulerText;
      g.beginPath();
      g.moveTo(px - 5, SCRUB_H - 7);
      g.lineTo(px + 6, SCRUB_H - 7);
      g.lineTo(px + 0.5, SCRUB_H - 1);
      g.closePath();
      g.fill();
      this.vline(px, SCRUB_H - 1, RULER_H_BELOW_LOOP - SCRUB_H, store.playing ? C.playhead : C.insertMarker);
    }
    g.restore();
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

  // ---------------------------------------------------------------- keyboard

  private drawKeys(active: Set<number>): void {
    const { g, vp, overlay } = this;
    const rh = vp.rowHeight;
    this.clipTo(0, RULER_H, KEYS_W, vp.height);
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
    g.restore();
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
