// Transient interaction state the editor exposes for drawing (hover, marquee, ghost note...).

export interface Overlay {
  hoverNote: number | null;
  hoverPitch: number | null; // row under the cursor (grid or keyboard)
  ghost: { pitch: number; start: number; duration: number } | null;
  /** Marquee corners in content pixels (independent of scroll). */
  marquee: { x0: number; y0: number; x1: number; y1: number } | null;
  velocityNote: number | null; // stem under the cursor / being dragged in the velocity lane
  pressedKeys: Set<number>; // auditioned with the mouse
  heldKeys: Set<number>; // played on the computer keyboard
}

export function createOverlay(): Overlay {
  return {
    hoverNote: null,
    hoverPitch: null,
    ghost: null,
    marquee: null,
    velocityNote: null,
    pressedKeys: new Set(),
    heldKeys: new Set(),
  };
}
