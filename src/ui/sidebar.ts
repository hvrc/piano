// Left sidebar: the saved tracks. Click to open; hover for download and delete.
import type { Session } from '../library/session';
import type { TrackRecord } from '../library/trackStore';
import { BEATS_PER_BAR, EPS } from '../timeline/grid';
import { notesEnd } from '../model/note';
import { $ } from './dom';

const DOWNLOAD_ICON = '<span class="msr" aria-hidden="true">download</span>';
const DELETE_ICON = '<span class="msr" aria-hidden="true">delete</span>';

export function mountSidebar(session: Session): void {
  const list = $('track-list');
  const empty = $('track-empty');
  $('btn-new').addEventListener('click', () => void session.newTrack());

  const render = () => {
    list.replaceChildren(...session.tracks.map((t) => item(session, t)));
    empty.hidden = session.tracks.length > 0 && !session.loadError;
    if (!session.ready) empty.textContent = 'Loading tracks…';
    else if (session.loadError) empty.textContent = session.loadError;
    else empty.innerHTML = 'No saved tracks yet.<br />Press ⌘S to save this roll — saved tracks are public.';
  };
  session.subscribe(render);
  render();
}

function item(session: Session, t: TrackRecord): HTMLLIElement {
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
  dl.innerHTML = DOWNLOAD_ICON;
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
