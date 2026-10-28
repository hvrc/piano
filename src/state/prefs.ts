// Personal preferences that persist in this browser across every session (not part of a track).
import { storageGetJson, storageSet } from '../util/storage';
import { NOTE_COLOR } from '../model/colors';

export interface Prefs {
  noteColor: string | null; // default colour for uncoloured notes; null = the theme's
  metronome: boolean; // click on every beat while playing or recording
  midi: boolean; // connect MIDI keyboards automatically
}

const KEY = 'piano:prefs';
const DEFAULTS: Prefs = { noteColor: null, metronome: false, midi: false };

class PrefsStore {
  value: Prefs;
  private listeners = new Set<() => void>();

  constructor() {
    const saved = storageGetJson<Prefs>(KEY);
    this.value = { ...DEFAULTS, ...saved };
    if (this.value.noteColor && !NOTE_COLOR.test(this.value.noteColor)) this.value.noteColor = null;
  }

  set(patch: Partial<Prefs>): void {
    this.value = { ...this.value, ...patch };
    storageSet(KEY, JSON.stringify(this.value));
    for (const fn of this.listeners) fn();
  }

  subscribe(fn: () => void): void {
    this.listeners.add(fn);
  }
}

export const prefs = new PrefsStore();
