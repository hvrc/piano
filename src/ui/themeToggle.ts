// Cycles through every theme: page CSS variables (data-theme on <html>) and the canvas palette.
import { setCanvasTheme, THEME_LABELS, THEMES, type ThemeName } from '../render/theme';
import { storageGet, storageSet } from '../util/storage';
import { $ } from './dom';

const STORAGE = 'piano:theme';

/** Each theme's icon on the toggle (Material Symbols): a sheet of paper, a cup of coffee. */
const ICONS: Record<ThemeName, string> = { paper: 'description', espresso: 'coffee' };

export function mountThemeToggle(onChange: () => void): void {
  const button = $<HTMLButtonElement>('btn-theme');
  const stored = storageGet(STORAGE);
  let current: ThemeName = THEMES.includes(stored as ThemeName) ? (stored as ThemeName) : THEMES[0];

  const apply = () => {
    document.documentElement.dataset.theme = current;
    setCanvasTheme(current);
    button.innerHTML = `<span class="msr" aria-hidden="true">${ICONS[current]}</span>`;
    const next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length];
    button.title = `Theme: ${THEME_LABELS[current]} — click for ${THEME_LABELS[next]}`;
    button.setAttribute('aria-label', button.title);
    onChange();
  };

  button.addEventListener('click', () => {
    current = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length];
    storageSet(STORAGE, current);
    apply();
  });
  apply();
}
