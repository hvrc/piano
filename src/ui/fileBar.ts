// Left side of the top bar: sidebar toggle, track name, save, MIDI open/download.
import type { Session } from '../library/session';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function mountFileBar(session: Session, opts: { onToggleSidebar: () => void }): { openFilePicker: () => void } {
  const name = $<HTMLInputElement>('track-name');
  const dirty = $<HTMLSpanElement>('dirty');
  const save = $<HTMLButtonElement>('btn-save');
  const open = $<HTMLButtonElement>('btn-open');
  const download = $<HTMLButtonElement>('btn-download');
  const sidebar = $<HTMLButtonElement>('btn-sidebar');
  const fileInput = $<HTMLInputElement>('file-input');

  let before = '';
  name.addEventListener('focus', () => (before = name.value));
  name.addEventListener('input', () => session.setName(name.value));
  name.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') name.blur();
    if (e.key === 'Escape') {
      name.value = before;
      session.setName(before);
      name.blur();
    }
  });

  save.addEventListener('click', () => void session.save());
  download.addEventListener('click', () => session.download());
  sidebar.addEventListener('click', opts.onToggleSidebar);
  const openFilePicker = () => fileInput.click();
  open.addEventListener('click', openFilePicker);
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) void session.importFile(file);
  });

  // Drop a .mid anywhere on the window to open it.
  window.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
  });
  window.addEventListener('drop', (e) => {
    const file = [...(e.dataTransfer?.files ?? [])].find((f) => /\.midi?$/i.test(f.name));
    if (!file) return;
    e.preventDefault();
    void session.importFile(file);
  });

  const sync = () => {
    if (document.activeElement !== name) name.value = session.name;
    dirty.classList.toggle('show', session.dirty);
    save.classList.toggle('attention', session.dirty);
    save.title = session.trackId ? 'Save (⌘S) · ⇧⌘S saves a copy' : 'Save as a new track (⌘S)';
  };
  session.subscribe(sync);
  sync();
  return { openFilePicker };
}
