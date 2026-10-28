// Themes: page CSS variables (data-theme on <html>) plus the canvas palette. The top-bar button
// cycles through them; the settings panel picks one directly. The choice is remembered.
import { setCanvasTheme, THEME_LABELS, THEMES, type ThemeName } from '../render/theme';
import { storageGet, storageSet } from '../util/storage';
import { $ } from './dom';

const STORAGE = 'piano:theme';

/** Each theme's icon (Material Symbols): a sheet of paper, a cup of coffee. */
export const THEME_ICONS: Record<ThemeName, string> = { paper: 'description', espresso: 'coffee' };

export interface ThemeController {
  readonly current: ThemeName;
  set(name: ThemeName): void;
  subscribe(fn: () => void): void;
}

export function mountThemeToggle(onChange: () => void): ThemeController {
  const button = $<HTMLButtonElement>('btn-theme');
  const stored = storageGet(STORAGE);
  let current: ThemeName = THEMES.includes(stored as ThemeName) ? (stored as ThemeName) : THEMES[0];
  const listeners = new Set<() => void>();

  const apply = () => {
    document.documentElement.dataset.theme = current;
    setCanvasTheme(current);
    const next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length];
    button.innerHTML = `<span class="msr" aria-hidden="true">${THEME_ICONS[current]}</span>`;
    button.title = `Theme: ${THEME_LABELS[current]} — click for ${THEME_LABELS[next]}`;
    button.setAttribute('aria-label', button.title);
    onChange();
    for (const fn of listeners) fn();
  };

  const controller: ThemeController = {
    get current() {
      return current;
    },
    set(name) {
      current = name;
      storageSet(STORAGE, current);
      apply();
    },
    subscribe(fn) {
      listeners.add(fn);
    },
  };
  button.addEventListener('click', () => controller.set(THEMES[(THEMES.indexOf(current) + 1) % THEMES.length]));
  apply();
  return controller;
}
