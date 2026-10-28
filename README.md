# piano

A single-track piano roll in the browser, modelled on Ableton Live's MIDI note editor. Draw notes, edit them, play them back on a sampled grand piano, play live from the computer keyboard, save tracks, and import or export MIDI.

**Live:** https://piano.hvrc.place

```sh
pnpm install
pnpm dev        # http://localhost:5190 (one server: API + Vite with hot reload; tracks go in data/tracks.json)
pnpm test       # MIDI codec + tracks API tests
pnpm build      # typecheck (client + server) + production build into dist/
pnpm start      # run the production server locally (needs a build)
```

Press `?` (or the ? button) in the app to see every shortcut.

## Interaction model (from Live 12)

| Action | How |
|---|---|
| Draw mode | `B`. Click or drag to paint grid-length notes that follow the mouse pitch. Hold ⌥ to lock pitch. Click a note to erase it, and keep dragging to erase more. |
| Add / delete (selection mode) | Double-click empty space / a note |
| Select | Click, ⇧-click to toggle, drag empty space for a marquee, ⌘A, Esc |
| Move | Drag a note; snaps to the grid. ⌘ while dragging bypasses snap |
| Copy | ⌥-drag. Pressing or releasing ⌥ mid-drag switches between move and copy |
| Resize | Drag a note's left or right edge |
| Keyboard edits | ↑↓ semitone, ⇧↑↓ octave, ←→ move by grid, ⇧←→ change length, ⌘D duplicate, ⌘C/X/V (paste at the playhead), ⌫ delete, ⌘Z / ⇧⌘Z |
| Boneless | The **Boneless** button (or `4`) turns all snapping off. Notes are drawn, moved and resized exactly where you put them, and so are the loop brace and seeking. In draw mode a click places a note right under the mouse, and dragging paints a new note each time you travel one grid length. Holding ⌘ while dragging is a one-off Boneless |
| Velocity | The lane under the notes shows one stem per note (height = velocity, 1–127). Drag a stem to change it; if it's selected, all selected notes move together. In draw mode, sweep across the lane to paint velocities. ⌘↑/⌘↓ change the selection by ±10. Note colour also follows velocity, and playback uses it |
| Legato | **Legato** (`⇧⌘L`) stretches each note to end exactly where the next one starts (chords move together; the last note keeps its length), as in Live. Works on the selection, or all notes |
| Humanize | **Humanize** opens a small panel: Timing (±ms, default 15) nudges each note randomly earlier or later, keeping its length, and Velocity (±) adds random velocity variation. Nudges are weighted towards small values. Works on the selection, or all notes. Press again for another nudge; ⌘Z undoes |
| Grid | ⌘1/⌘2 narrow/widen, ⌘3 triplets, ⌘4 Boneless. Chrome reserves ⌘+digit, so plain `1`–`4` also work |
| Audition | Click or drag on the keyboard. ⇧-click a key selects all notes of that pitch |
| Navigate | Scroll / ⇧-scroll; ⌘-scroll or pinch zooms time; ⌥-scroll zooms key height; `+`/`−`; PageUp/PageDown move an octave |
| Ruler | Upper strip: click or drag to move the playhead. Lower strip: drag ↕ to zoom, ↔ to scroll, click to move the playhead |
| Loop | Like Live's loop brace: the top lane of the ruler holds the brace. Drag its middle to move it, its ends to resize, or drag an empty part of the lane to draw a new loop. Click the brace, press `L`, or use the loop button to switch it on/off. `⌘L` loops the selected notes. With the loop on, playback jumps from the loop end back to its start (sample-accurate) and notes are cut at the loop end. The area outside the loop is dimmed. The loop is saved with the track |
| Transport | Space plays/pauses (resumes from the paused position), Home returns to start, ←→ with nothing selected moves the playhead |

| Computer keyboard | `M` (or the keyboard button) toggles it. `A W S E D F T G Y H U J K O L P ; '` play C up to the F an octave and a half above. `Z`/`X` shift the octave, `C`/`V` change velocity by 20. The orange bar beside the keys shows the playable range. It uses physical key positions, so it works on any keyboard layout |
| Tracks | Edit the name in the top bar, then `⌘S` saves (`⇧⌘S` saves a copy). The dot means unsaved changes. The sidebar lists saved tracks: click one to open it, hover for download and delete (click delete twice). **+ New** starts an empty roll. You're asked before unsaved work is discarded |
| MIDI | The ↓ button downloads the roll as a `.mid` file. The ↑ button (`⌘O`), or dropping a `.mid` on the window, opens one as a new unsaved roll. Format 0/1 files are read with all channels merged and GM drums dropped. Exports are format 0 at 480 PPQ with tempo, 4/4 and the Acoustic Grand program |

Octave naming follows Live: MIDI 60 = **C3**, full range C-2 (0) to G8 (127).

Playback follows the playhead like Live 12's "Scroll" follow mode: once the playhead reaches the middle of the view it stays there and the grid scrolls smoothly underneath. A loop that fits on screen is kept in view instead, so the playhead cycles inside it. If you scroll the playhead out of sight, following pauses until it's visible again.

## Saved tracks

Saved tracks are **public**: there is one shared list, and everyone who visits sees it and can open, overwrite or delete any track in it. The list refreshes when you come back to the tab. The server still validates every track and rate-limits writes.

## Themes

The ◐ button cycles through every theme, and your choice is remembered:
- **Paper**: warm paper, black ink and a few light inks.
- **Espresso**: after Streamcell's theme of the same name. A warm brown-black room, cream ink, latte notes, a steel-blue selection and loop, and a honey playhead.

Each theme has a CSS variable block (`:root[data-theme=…]` in `styles.css`) plus a canvas palette (`render/theme.ts`).

Fonts: Bungee Hairline for text, numbers and buttons, and Ballet for the handwritten titles and labels (Google Fonts).

## Architecture

All timing is musical. Notes are `{ id, pitch, start, duration, velocity }` with `start` and `duration` in beats. Pixels are derived from them only while rendering and handling input.

```
src/
  model/note.ts           Note / NoteData, velocity limits, note helpers (shared with server & tests)
  model/track.ts          saved-track format + limits (BPM, sizes, id/key formats), shared with the server
  music/pitch.ts          pitch names (Live convention), black/white keys, range checks
  state/store.ts          notes, selection, bpm, position, grid, mode, loop, keyboard; undo/redo snapshots
  timeline/grid.ts        grid divisions, snapping, bar.beat.sixteenth formatting
  timeline/viewport.ts    beat/pitch ↔ pixel mapping, scroll, zoom (announces changes via onChange)
  render/layout.ts        where every region sits on the canvas (shared by renderer + editor)
  render/renderer.ts      canvas drawing: grid, notes, ruler, loop brace, keyboard, velocity lane
  render/theme.ts         colours
  editing/editor.ts       pointer interactions (draw, select, move, resize, marquee, velocity, loop, ruler)
  editing/commands.ts     undoable note operations shared by mouse and keyboard
  editing/transforms.ts   pure Humanize / Legato (unit-tested in Node)
  editing/shortcuts.ts    keyboard map
  input/computerKeyboard.ts  Live's computer MIDI keyboard
  playback/transport.ts   play/pause/seek/tempo/loop + lookahead scheduler on the AudioContext clock
  playback/follow.ts      keeps the playhead in view (smooth scroll, loop-aware)
  audio/                  Instrument interface, sampled piano, synth fallback, shared voice pool, master bus
  midi/smf.ts             Standard MIDI File encoder/decoder
  library/session.ts      the open document: dirty tracking, save/open/new/import/export
  library/trackStore.ts   tracks API client (one public list)
  ui/                     top bar, file bar, sidebar, tools (Legato/Humanize), dialogs, `$` helper
  util/storage.ts         safe localStorage helpers
server/
  index.ts                node:http server: /api/tracks, static dist/, Vite middleware in dev
  store.ts                FileStore (dev) / Firestore store (prod), notes packed as a flat array
  validate.ts             request validation using the shared limits in src/model
```

Scheduling uses the "two clocks" pattern. A 25 ms timer schedules notes about 120 ms ahead at exact `AudioContext` times. The playhead is drawn from `getOutputTimestamp()`, so it lines up with what you hear. Changing the tempo mid-play re-anchors at the last scheduled beat, so nothing already scheduled shifts.

To swap the piano, implement `Instrument` (`noteOn(pitch, velocity, when) → { release(when) }` plus `allNotesOff()`) and use it in `audio/piano.ts`.

No runtime dependencies; dev-only Vite + TypeScript.

## Sound

The piano is the **Salamander Grand Piano V3** by Alexander Holm, licensed **CC-BY 3.0**, using the 30-sample MP3 set that Tone.js hosts (about 2 MB, in `public/samples/salamander`). It has one velocity layer. Softer notes are rendered quieter and darker with a filter.

Options for better sound later, roughly in order of effort:
- Full Salamander (16 velocity layers, CC-BY), streamed per velocity.
- `smplr`'s SplendidGrandPiano: multi-velocity, ready-made Web Audio loader. Check the sample licence before shipping.
- Spitfire LABS: free, but its licence doesn't allow redistributing the samples, so it can't ship in a web app. Use it as a sound reference only.

## Deployment

| | |
|---|---|
| Service | Cloud Run `piano`, project `hvrc-web`, us-east1. Public, 0–3 instances, 512 MiB |
| Domain | https://piano.hvrc.place (Cloud Run domain mapping; Squarespace DNS `CNAME piano → ghs.googlehosted.com`) |
| Data | Firestore Native database `piano` (us-east1): `tracks/{id}` (one public list). Tracks saved before tracks were public are under `libraries/*/tracks`; `node scripts/migrate-to-public.mjs --apply` copies them into the public list. Delete protection on, point-in-time recovery 7 days, daily backups kept 7 days |
| Auto-deploy | Push to **`release`** → GitHub Actions (`.github/workflows/deploy.yml`): typecheck + tests, Docker build, push to `us-east1-docker.pkg.dev/hvrc-web/cloud-run-source-deploy/piano:<sha>`, `gcloud run deploy` |
| Auth for CI | Keyless, via Workload Identity Federation. Pool `github` and provider `github` only accept tokens from repositories owned by `hvrc`. Only `hvrc/piano` may impersonate `piano-deployer@hvrc-web.iam.gserviceaccount.com`, which holds `run.developer` on this service only, `iam.serviceAccountUser` on the runtime SA, and `artifactregistry.writer` on the registry |
| Manual fallback | `./deploy.sh` (Cloud Build from source; `--map` recreates the domain mapping) |

Release flow: work on `main`, then `git push origin main:release`.

To give another `hvrc/*` repo the same auto-deploy, no Console steps are needed:

```sh
gcloud iam service-accounts add-iam-policy-binding <deployer-sa> --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/883511463333/locations/global/workloadIdentityPools/github/attribute.repository/hvrc/<repo>"
```

Then copy `.github/workflows/deploy.yml`.

## Not built (on purpose)

Multiple tracks/instruments, mixer, recording, effects, MIDI hardware input, automation, accounts, and anything else from a full DAW.
