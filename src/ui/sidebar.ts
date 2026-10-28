// Left sidebar: the saved tracks, optionally filed in folders. Click to open; hover for move,
// download and delete. Drag a track onto a folder to file it, or onto open space to unfile it.
// A folder lives on its tracks (TrackRecord.folder); one with no tracks yet is kept in this browser.
import type { Session } from '../library/session';
import type { TrackRecord } from '../library/trackStore';
import { BEATS_PER_BAR, EPS } from '../timeline/grid';
import { notesEnd } from '../model/note';
import { MAX_FOLDER_NAME } from '../model/track';
import { storageGet, storageSet } from '../util/storage';
import { choose } from './dialog';
import { $ } from './dom';

const icon = (name: string) => `<span class="msr" aria-hidden="true">${name}</span>`;
const DELETE_ICON = icon('delete');
const DRAG_TYPE = 'text/x-piano-track';
const EMPTY_FOLDERS_KEY = 'piano:folders';
const CLOSED_KEY = 'piano:folders-closed';

function loadList(key: string): string[] {
  try {
    const v = JSON.parse(storageGet(key) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function mountSidebar(session: Session): void {
  const list = $('track-list');
  const empty = $('track-empty');
  $('btn-new').addEventListener('click', () => void session.newTrack());

  let emptyFolders = loadList(EMPTY_FOLDERS_KEY);
  const closed = new Set(loadList(CLOSED_KEY));
  /** The folder whose name is being typed: '' for a brand-new one. */
  let editing: { from: string; value: string } | null = null;
  let menuFor: string | null = null;
  let rendering = false; // re-rendering removes the name input; that blur isn't a commit

  const saveLocal = () => {
    storageSet(EMPTY_FOLDERS_KEY, JSON.stringify(emptyFolders));
    storageSet(CLOSED_KEY, JSON.stringify([...closed]));
  };
  const folderNames = () =>
    [...new Set([...session.tracks.flatMap((t) => (t.folder ? [t.folder] : [])), ...emptyFolders])].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }),
    );

  const move = async (id: string, folder: string) => {
    menuFor = null;
    await session.moveToFolder(id, folder);
    render();
  };

  const commitName = async () => {
    if (!editing) return;
    const { from, value } = editing;
    editing = null;
    const name = value.trim().slice(0, MAX_FOLDER_NAME);
    if (name && name !== from) {
      emptyFolders = [...emptyFolders.filter((f) => f !== from), name];
      if (closed.delete(from)) closed.add(name);
      saveLocal();
      if (from) await session.renameFolder(from, name);
    }
    render();
  };

  const removeFolder = async (name: string) => {
    const inside = session.tracks.filter((t) => t.folder === name);
    if (inside.length) {
      const ok = await choose(
        `Remove “${name}”?`,
        `Its ${inside.length} track${inside.length === 1 ? '' : 's'} stay saved — they just move out of the folder.`,
        [
          { label: 'Cancel', value: 'cancel' },
          { label: 'Remove folder', value: 'ok', primary: true },
        ],
      );
      if (ok !== 'ok') return;
      for (const t of inside) if (!(await session.moveToFolder(t.id, ''))) return;
    }
    emptyFolders = emptyFolders.filter((f) => f !== name);
    saveLocal();
    render();
  };

  const nameInput = (): HTMLInputElement => {
    const input = document.createElement('input');
    input.className = 'folder-input';
    input.value = editing!.value;
    input.placeholder = 'Folder name';
    input.maxLength = MAX_FOLDER_NAME;
    input.addEventListener('input', () => editing && (editing.value = input.value));
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // typing a name must not trigger shortcuts
      if (e.key === 'Enter') input.blur();
      else if (e.key === 'Escape') {
        editing = null;
        render();
      }
    });
    input.addEventListener('blur', () => !rendering && void commitName());
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
    return input;
  };

  const dropTarget = (el: HTMLElement, folder: string) => {
    el.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      e.stopPropagation();
      el.classList.add('drop');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop'));
    el.addEventListener('drop', (e) => {
      const id = e.dataTransfer?.getData(DRAG_TYPE);
      el.classList.remove('drop');
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();
      void move(id, folder);
    });
  };
  dropTarget(list, '');

  const folderItem = (name: string, tracks: TrackRecord[]): HTMLLIElement => {
    const li = document.createElement('li');
    const open = !closed.has(name);
    li.className = 'folder' + (open ? ' open' : '');

    const head = document.createElement('div');
    head.className = 'folder-head';
    if (editing?.from === name) {
      head.innerHTML = icon('folder_open');
      head.append(nameInput());
    } else {
      const toggle = document.createElement('button');
      toggle.className = 'folder-main';
      toggle.title = open ? 'Collapse' : 'Expand';
      toggle.innerHTML = `${icon('chevron_right')}${icon(open ? 'folder_open' : 'folder')}`;
      const label = document.createElement('span');
      label.className = 'folder-name';
      label.textContent = name;
      const count = document.createElement('span');
      count.className = 'folder-count';
      count.textContent = String(tracks.length);
      toggle.append(label, count);
      toggle.addEventListener('click', () => {
        if (!closed.delete(name)) closed.add(name);
        saveLocal();
        render();
      });
      toggle.addEventListener('dblclick', () => {
        editing = { from: name, value: name };
        render();
      });

      const rename = document.createElement('button');
      rename.className = 'track-action';
      rename.title = 'Rename folder';
      rename.innerHTML = icon('edit');
      rename.addEventListener('click', () => {
        editing = { from: name, value: name };
        render();
      });
      const del = document.createElement('button');
      del.className = 'track-action delete';
      del.title = 'Remove folder (its tracks are kept)';
      del.innerHTML = DELETE_ICON;
      del.addEventListener('click', () => void removeFolder(name));
      const actions = document.createElement('span');
      actions.className = 'track-actions';
      actions.append(rename, del);
      head.append(toggle, actions);
    }
    dropTarget(li, name);
    li.append(head);

    if (open) {
      const ul = document.createElement('ul');
      ul.className = 'folder-tracks';
      ul.append(...tracks.map((t) => item(t)));
      if (!tracks.length) {
        const hint = document.createElement('li');
        hint.className = 'folder-empty';
        hint.textContent = 'Drag tracks here';
        ul.append(hint);
      }
      li.append(ul);
    }
    return li;
  };

  const moveMenu = (t: TrackRecord): HTMLElement => {
    const menu = document.createElement('div');
    menu.className = 'move-menu';
    const options = [...folderNames().map((f) => [f, f]), ['', 'No folder']];
    for (const [value, label] of options) {
      const b = document.createElement('button');
      b.className = 'text' + ((t.folder ?? '') === value ? ' on' : '');
      b.textContent = label;
      b.addEventListener('click', () => void move(t.id, value));
      menu.append(b);
    }
    if (!folderNames().length) {
      const p = document.createElement('p');
      p.textContent = 'No folders yet — make one with the folder button above.';
      menu.prepend(p);
    }
    return menu;
  };

  const item = (t: TrackRecord): HTMLLIElement => {
    const li = trackItem(session, t);
    li.draggable = true;
    li.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData(DRAG_TYPE, t.id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      li.classList.add('dragging');
    });
    li.addEventListener('dragend', () => li.classList.remove('dragging'));

    const mv = document.createElement('button');
    mv.className = 'track-action' + (menuFor === t.id ? ' armed-soft' : '');
    mv.title = 'Move to folder';
    mv.innerHTML = icon('drive_file_move');
    mv.addEventListener('click', () => {
      menuFor = menuFor === t.id ? null : t.id;
      render();
    });
    li.querySelector('.track-actions')!.prepend(mv);
    if (menuFor === t.id) {
      li.classList.add('menu-open');
      li.append(moveMenu(t));
    }
    return li;
  };

  document.addEventListener('pointerdown', (e) => {
    if (menuFor && !(e.target as Element).closest('.move-menu, .track-action')) {
      menuFor = null;
      render();
    }
  });

  $('btn-new-folder').addEventListener('click', () => {
    editing = { from: '', value: '' };
    render();
  });

  function render() {
    const folders = folderNames();
    const rows: HTMLLIElement[] = [];
    if (editing?.from === '') {
      const li = document.createElement('li');
      li.className = 'folder open';
      const head = document.createElement('div');
      head.className = 'folder-head';
      head.innerHTML = icon('create_new_folder');
      head.append(nameInput());
      li.append(head);
      rows.push(li);
    }
    for (const f of folders) rows.push(folderItem(f, session.tracks.filter((t) => t.folder === f)));
    rows.push(...session.tracks.filter((t) => !t.folder).map(item));
    rendering = true;
    list.replaceChildren(...rows);
    rendering = false;

    empty.hidden = session.tracks.length > 0 && !session.loadError;
    if (!session.ready) empty.textContent = 'Loading tracks…';
    else if (session.loadError) empty.textContent = session.loadError;
    else empty.innerHTML = 'No saved tracks yet.<br />Press ⌘S to save this roll — saved tracks are public.';
  }
  session.subscribe(render);
  render();
}

function trackItem(session: Session, t: TrackRecord): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'track' + (t.id === session.trackId ? ' current' : '');

  const main = document.createElement('button');
  main.className = 'track-main';
  main.title = `Open “${t.name}”`;
  const title = document.createElement('span');
  title.className = 'track-name';
  title.textContent = t.id === session.trackId && session.dirty ? `${t.name} •` : t.name;
  const meta = document.createElement('span');
  meta.className = 'track-meta';
  meta.textContent = describe(t);
  main.append(title, meta);
  main.addEventListener('click', () => void session.open(t.id));

  const dl = document.createElement('button');
  dl.className = 'track-action';
  dl.title = 'Download MIDI';
  dl.innerHTML = icon('download');
  dl.addEventListener('click', () => session.downloadTrack(t));

  // Two-step delete: first click arms, second click deletes.
  const del = document.createElement('button');
  del.className = 'track-action delete';
  del.title = 'Delete track';
  del.innerHTML = DELETE_ICON;
  let timer = 0;
  del.addEventListener('click', () => {
    if (del.classList.contains('armed')) {
      window.clearTimeout(timer);
      void session.remove(t.id);
      return;
    }
    del.classList.add('armed');
    del.textContent = 'Delete?';
    timer = window.setTimeout(() => {
      del.classList.remove('armed');
      del.innerHTML = DELETE_ICON;
    }, 3000);
  });

  const actions = document.createElement('span');
  actions.className = 'track-actions';
  actions.append(dl, del);
  li.append(main, actions);
  return li;
}

function describe(t: TrackRecord): string {
  const bars = Math.max(1, Math.ceil(notesEnd(t.notes) / BEATS_PER_BAR - EPS));
  const notes = `${t.notes.length} note${t.notes.length === 1 ? '' : 's'}`;
  return `${notes} · ${bars} bar${bars === 1 ? '' : 's'} · ${formatDate(t.updatedAt)}`;
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
