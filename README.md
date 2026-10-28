# piano

A single-track piano roll in the browser, modelled on Ableton Live's MIDI note editor. Draw notes, edit them, and play them back on a sampled grand piano.

```sh
pnpm install
pnpm dev        # http://localhost:5190
pnpm build      # typecheck + production build into dist/
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
| Grid | ⌘1/⌘2 narrow/widen, ⌘3 triplets, ⌘4 snap. Chrome reserves ⌘+digit, so plain `1`–`4` also work |
| Audition | Click or drag on the keyboard. ⇧-click a key selects all notes of that pitch |
| Navigate | Scroll / ⇧-scroll; ⌘-scroll or pinch zooms time; ⌥-scroll zooms key height; `+`/`−`; PageUp/PageDown move an octave |
| Ruler | Upper strip: click or drag to move the playhead. Lower strip: drag ↕ to zoom, ↔ to scroll, click to move the playhead |
| Transport | Space plays/pauses (resumes from the paused position), Home returns to start, ←→ with nothing selected moves the playhead |

Octave naming follows Live: MIDI 60 = **C3**, full range C-2 (0) to G8 (127).

Playback follows the playhead, flipping a page when it runs off the right edge, as Live's Follow does. If you scroll away while it's playing, the view stays put until the playhead is back in sight.

## Architecture

All timing is musical. Notes are `{ id, pitch, start, duration, velocity }` with `start` and `duration` in beats. Pixels are derived from them only while rendering and handling input.

```
src/
  model/note.ts           Note type
  music/pitch.ts          pitch names (Live convention), black/white keys
  state/store.ts          notes, selection, bpm, position, grid, mode; undo/redo snapshots
  timeline/grid.ts        grid divisions, snapping, bar.beat.sixteenth formatting
  timeline/viewport.ts    beat/pitch ↔ pixel mapping, scroll, zoom
  render/                 canvas renderer (grid, notes, ruler, keyboard, playhead), theme, layout
  editing/editor.ts       pointer interactions (draw, select, move, resize, marquee, audition, ruler)
  editing/commands.ts     undoable note operations shared by mouse and keyboard
  editing/shortcuts.ts    keyboard map
  playback/transport.ts   play/pause/seek/tempo + lookahead scheduler on the AudioContext clock
  audio/instrument.ts     Instrument interface (noteOn → Voice.release)
  audio/sampledPiano.ts   Salamander sampler (repitched every minor third, velocity → gain + brightness)
  audio/synthPiano.ts     fallback synth while samples load or if they fail
  audio/piano.ts          picks sampled or synth
  audio/output.ts         master bus: light room reverb + compressor
  ui/transportBar.ts      top bar
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

## Not built (on purpose)

Multiple tracks, mixer, recording, effects, MIDI input, save/load, export, velocity lanes, automation, and anything else from a full DAW. Note that **nothing is saved**: reloading the page clears the roll.
