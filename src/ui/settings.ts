// The settings panel (replaces the old shortcuts overlay): theme, default note colour, MIDI
// keyboard, sound status, and the shortcut list.
import { THEME_LABELS, THEMES } from '../render/theme';
import { $ } from './dom';
import { THEME_ICONS, type ThemeController } from './themeToggle';

export interface SettingsPanel {
  toggle(show?: boolean): void;
  setMidiStatus(text: string, connected: boolean): void;
}

export function mountSettings(theme: ThemeController, onConnectMidi: () => void): SettingsPanel {
  const panel = $('help');
  const toggle = (show?: boolean) => {
    panel.hidden = show === undefined ? !panel.hidden : !show;
  };
  $('btn-settings').addEventListener('click', () => toggle());
  $('settings-close').addEventListener('click', () => toggle(false));
  panel.addEventListener('pointerdown', (e) => {
    if (e.target === panel) toggle(false); // click outside the card
  });

  // Theme choices
  const choices = $('theme-choices');
  for (const name of THEMES) {
    const b = document.createElement('button');
    b.className = 'text';
    b.dataset.theme = name;
    b.innerHTML = `<span class="msr" aria-hidden="true">${THEME_ICONS[name]}</span>${THEME_LABELS[name]}`;
    b.addEventListener('click', () => theme.set(name));
    choices.append(b);
  }
  const syncTheme = () => {
    for (const b of choices.querySelectorAll<HTMLButtonElement>('button')) b.classList.toggle('on', b.dataset.theme === theme.current);
  };
  theme.subscribe(syncTheme);
  syncTheme();

  // MIDI keyboard
  const midiStatus = $('midi-status');
  const midiButton = $<HTMLButtonElement>('midi-connect');
  midiButton.addEventListener('click', onConnectMidi);

  return {
    toggle,
    setMidiStatus(text, connected) {
      midiStatus.textContent = text;
      midiButton.textContent = connected ? 'Reconnect' : 'Connect MIDI keyboard';
    },
  };
}
