// Ableton Live's "Computer MIDI Keyboard": the home row plays white keys, the row above plays
// black keys (A W S E D F T G Y H U J K O L P ; ' = C up to the F an octave and a half above).
// Z / X shift the octave, C / V change velocity. Uses physical key codes, so it works on any layout.
import type { LiveInput } from './liveInput';
import { MAX_PITCH } from '../music/pitch';
import { clampVelocity } from '../model/note';
import type { Store } from '../state/store';

const KEY_OFFSETS: Record<string, number> = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8,
  KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16, Quote: 17,
};

const MAX_BASE = 120; // C8
const VELOCITY_STEP = 20;

export class ComputerKeyboard {
  private held = new Map<string, number>(); // key code → pitch

  constructor(
    private store: Store,
    private live: LiveInput,
  ) {
    window.addEventListener('keyup', (e) => this.keyUp(e.code));
    window.addEventListener('blur', () => this.releaseAll());
  }

  toggle(): void {
    if (this.store.keyboard.enabled) this.releaseAll();
    this.store.setKeyboard({ enabled: !this.store.keyboard.enabled });
  }

  /** Returns true when the key was consumed by the keyboard. */
  keyDown(e: KeyboardEvent): boolean {
    const kb = this.store.keyboard;
    if (!kb.enabled || e.metaKey || e.ctrlKey || e.altKey) return false;
    const offset = KEY_OFFSETS[e.code];
    if (offset !== undefined) {
      const pitch = kb.base + offset;
      if (!e.repeat && !this.held.has(e.code) && pitch <= MAX_PITCH) {
        this.held.set(e.code, pitch);
        this.live.noteOn('computer', pitch, kb.velocity);
      }
      return true;
    }
    switch (e.code) {
      case 'KeyZ':
        this.store.setKeyboard({ base: Math.max(0, kb.base - 12) });
        return true;
      case 'KeyX':
        this.store.setKeyboard({ base: Math.min(MAX_BASE, kb.base + 12) });
        return true;
      case 'KeyC':
        this.store.setKeyboard({ velocity: clampVelocity(kb.velocity - VELOCITY_STEP) });
        return true;
      case 'KeyV':
        this.store.setKeyboard({ velocity: clampVelocity(kb.velocity + VELOCITY_STEP) });
        return true;
    }
    return false;
  }

  private keyUp(code: string): void {
    const pitch = this.held.get(code);
    if (pitch === undefined) return;
    this.held.delete(code);
    this.live.noteOff('computer', pitch);
  }

  releaseAll(): void {
    for (const code of [...this.held.keys()]) this.keyUp(code);
  }
}
