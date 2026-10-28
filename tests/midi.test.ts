// MIDI codec round-trip and parsing edge cases. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeMidi, encodeMidi, MidiParseError, type MidiSong } from '../src/midi/smf.ts';

const song: MidiSong = {
  name: 'Round trip ✓',
  bpm: 97.5,
  notes: [
    { pitch: 60, start: 0, duration: 0.25, velocity: 100 },
    { pitch: 64, start: 0, duration: 1, velocity: 80 },
    { pitch: 60, start: 0.25, duration: 0.25, velocity: 127 }, // repeated pitch right after the first
    { pitch: 0, start: 1 / 3, duration: 2 / 3, velocity: 1 }, // triplets, extreme pitch
    { pitch: 127, start: 15.5, duration: 4, velocity: 64 },
  ],
};

const sorted = (s: MidiSong) => [...s.notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch);

test('encode → decode preserves name, tempo and notes', () => {
  const out = decodeMidi(encodeMidi(song).buffer as ArrayBuffer);
  assert.equal(out.name, song.name);
  assert.equal(out.bpm, song.bpm);
  const a = sorted(song);
  const b = sorted(out);
  assert.equal(b.length, a.length);
  a.forEach((n, i) => {
    assert.equal(b[i].pitch, n.pitch);
    assert.equal(b[i].velocity, n.velocity);
    assert.ok(Math.abs(b[i].start - n.start) < 1 / 480, `start ${b[i].start} vs ${n.start}`);
    assert.ok(Math.abs(b[i].duration - n.duration) < 1 / 480, `duration ${b[i].duration} vs ${n.duration}`);
  });
});

test('starts with a valid MThd header, format 0, 480 ppq', () => {
  const bytes = encodeMidi(song);
  assert.equal(String.fromCharCode(...bytes.subarray(0, 4)), 'MThd');
  const dv = new DataView(bytes.buffer);
  assert.equal(dv.getUint16(8), 0);
  assert.equal(dv.getUint16(12), 480);
});

test('reads format 1 with running status, note-on velocity 0, drums dropped', () => {
  // Hand-built: track 1 = tempo 100 bpm; track 2 = piano C4 (running status, vel-0 off) + a drum hit.
  const tempo = [0x00, 0xff, 0x51, 0x03, 0x09, 0x27, 0xc0, 0x00, 0xff, 0x2f, 0x00]; // 600000 µs = 100 bpm
  const notes = [
    0x00, 0x90, 60, 90, // note on ch0
    0x83, 0x60, 60, 0, // +480 ticks, running status note-on vel 0 = off
    0x00, 0x99, 36, 100, // drum on ch9
    0x10, 0x89, 36, 0,
    0x00, 0xff, 0x2f, 0x00,
  ];
  const chunk = (body: number[]) => [0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, body.length, ...body];
  const file = new Uint8Array([
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 2, 0x01, 0xe0,
    ...chunk(tempo),
    ...chunk(notes),
  ]);
  const out = decodeMidi(file.buffer);
  assert.equal(out.bpm, 100);
  assert.deepEqual(out.notes, [{ pitch: 60, start: 0, duration: 1, velocity: 90 }]);
});

test('rejects non-MIDI and truncated files with a readable error', () => {
  assert.throws(() => decodeMidi(new TextEncoder().encode('hello world, not midi').buffer), MidiParseError);
  const truncated = encodeMidi(song).slice(0, 30);
  assert.throws(() => decodeMidi(truncated.buffer), MidiParseError);
});
