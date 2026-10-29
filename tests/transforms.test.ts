import { test } from 'node:test';
import assert from 'node:assert/strict';
import { humanize, legato, quantize, reverse } from '../src/editing/transforms.ts';

// Deterministic pseudo-random sequence.
function rng(seed = 1) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
}

const notes = Array.from({ length: 200 }, (_, i) => ({ id: i, start: i * 0.25 + 1, duration: 0.25, velocity: 100 }));

test('humanize keeps every nudge within ±timing and leaves lengths alone', () => {
  const bpm = 120; // 1 beat = 500 ms, so 20 ms = 0.04 beats
  const out = humanize(notes, bpm, { timingMs: 20, velocity: 0 }, rng());
  let moved = 0;
  out.forEach((n, i) => {
    const d = n.start - notes[i].start;
    assert.ok(Math.abs(d) <= 0.04 + 1e-12, `nudge ${d}`);
    if (Math.abs(d) > 1e-9) moved++;
    assert.equal(n.duration, notes[i].duration);
    assert.equal(n.velocity, 100);
    assert.equal(n.id, notes[i].id);
  });
  assert.ok(moved > 190, 'nearly every note moves');
  const early = out.filter((n, i) => n.start < notes[i].start).length;
  assert.ok(early > 60 && early < 140, `both directions (${early} early)`);
});

test('humanize never moves a note before 0 and clamps velocity to 1–127', () => {
  const edge = [
    { start: 0, duration: 1, velocity: 126 },
    { start: 0.001, duration: 1, velocity: 2 },
  ];
  for (let s = 1; s < 50; s++) {
    for (const n of humanize(edge, 60, { timingMs: 100, velocity: 40 }, rng(s))) {
      assert.ok(n.start >= 0);
      assert.ok(n.velocity >= 1 && n.velocity <= 127);
    }
  }
});

test('humanize with zero amounts changes nothing', () => {
  assert.deepEqual(humanize(notes, 97, { timingMs: 0, velocity: 0 }, rng()), notes);
});

test('legato stretches each note to the next start, chords together, last unchanged', () => {
  const input = [
    { start: 0, duration: 0.25, velocity: 100 },
    { start: 0, duration: 0.5, velocity: 100 }, // chord with the first
    { start: 1, duration: 3, velocity: 100 }, // overlaps the next note: gets shortened
    { start: 2.5, duration: 0.1, velocity: 100 },
  ];
  assert.deepEqual(
    legato(input).map((n) => n.duration),
    [1, 1, 1.5, 0.1],
  );
});

test('reverse mirrors notes within the span they cover', () => {
  const input = [
    { id: 1, start: 1, duration: 1, velocity: 90 },
    { id: 2, start: 2, duration: 0.5, velocity: 80 },
    { id: 3, start: 4, duration: 2, velocity: 70 },
  ];
  const out = reverse(input); // span 1..6
  assert.deepEqual(out.map((n) => [n.id, n.start, n.duration, n.velocity]), [
    [1, 5, 1, 90],
    [2, 4.5, 0.5, 80],
    [3, 1, 2, 70],
  ]);
  assert.deepEqual(reverse(out), input, 'reversing twice is the identity');
});

test('quantize pulls starts to the grid, optionally ends, by an amount', () => {
  const n = (start: number, duration: number) => ({ start, duration, velocity: 100 });
  const input = [n(0.1, 0.5), n(0.9, 0.2), n(2.3, 0.05)];
  // Starts only: lengths kept.
  assert.deepEqual(quantize(input, 0.5, { amount: 1, ends: false }).map((x) => [x.start, x.duration]), [
    [0, 0.5],
    [1, 0.2],
    [2.5, 0.05],
  ]);
  // Half way.
  const half = quantize(input, 0.5, { amount: 0.5, ends: false }).map((x) => x.start);
  assert.ok(Math.abs(half[0] - 0.05) < 1e-9 && Math.abs(half[1] - 0.95) < 1e-9);
  // Ends too: a note collapsing onto its start keeps one grid step.
  assert.deepEqual(quantize(input, 0.5, { amount: 1, ends: true }).map((x) => [x.start, x.duration]), [
    [0, 0.5],
    [1, 0.5],
    [2.5, 0.5],
  ]);
});
