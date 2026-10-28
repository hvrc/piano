// Standard MIDI File (SMF) reading and writing.
// Writes format 0 (one track: name, tempo, 4/4, Acoustic Grand program, notes).
// Reads formats 0 and 1, merging every track and channel except General MIDI drums.

export interface MidiNote {
  pitch: number;
  start: number; // beats
  duration: number; // beats
  velocity: number;
}

export interface MidiSong {
  name?: string;
  bpm: number;
  notes: MidiNote[];
}

const PPQ = 480;
const DRUM_CHANNEL = 9;

// ------------------------------------------------------------------ writing

export function encodeMidi(song: MidiSong): Uint8Array {
  const events: { tick: number; order: number; bytes: number[] }[] = [];
  for (const n of song.notes) {
    const on = Math.max(0, Math.round(n.start * PPQ));
    const off = Math.max(on + 1, Math.round((n.start + n.duration) * PPQ));
    const vel = Math.max(1, Math.min(127, Math.round(n.velocity)));
    // At equal ticks note-offs go first, so repeated notes aren't cut short.
    events.push({ tick: on, order: 1, bytes: [0x90, n.pitch, vel] });
    events.push({ tick: off, order: 0, bytes: [0x80, n.pitch, 0] });
  }
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);

  const track: number[] = [];
  const name = new TextEncoder().encode(song.name ?? '');
  if (name.length) track.push(0, 0xff, 0x03, ...vlq(name.length), ...name);
  const mpq = Math.round(60_000_000 / song.bpm);
  track.push(0, 0xff, 0x51, 0x03, (mpq >> 16) & 0xff, (mpq >> 8) & 0xff, mpq & 0xff);
  track.push(0, 0xff, 0x58, 0x04, 4, 2, 24, 8); // 4/4
  track.push(0, 0xc0, 0); // program 0: Acoustic Grand Piano

  let last = 0;
  for (const e of events) {
    track.push(...vlq(e.tick - last), ...e.bytes);
    last = e.tick;
  }
  track.push(0, 0xff, 0x2f, 0x00);

  const out = new Uint8Array(14 + 8 + track.length);
  const dv = new DataView(out.buffer);
  out.set([0x4d, 0x54, 0x68, 0x64], 0); // MThd
  dv.setUint32(4, 6);
  dv.setUint16(8, 0); // format 0
  dv.setUint16(10, 1); // one track
  dv.setUint16(12, PPQ);
  out.set([0x4d, 0x54, 0x72, 0x6b], 14); // MTrk
  dv.setUint32(18, track.length);
  out.set(track, 22);
  return out;
}

function vlq(n: number): number[] {
  const bytes = [n & 0x7f];
  while ((n >>= 7) > 0) bytes.unshift((n & 0x7f) | 0x80);
  return bytes;
}

// ------------------------------------------------------------------ reading

export class MidiParseError extends Error {}

class Reader {
  pos = 0;
  private bytes: Uint8Array;
  private end: number;

  // Plain fields (no parameter properties) so Node can run this file with type stripping.
  constructor(bytes: Uint8Array, end = bytes.length) {
    this.bytes = bytes;
    this.end = end;
  }

  get done(): boolean {
    return this.pos >= this.end;
  }

  u8(): number {
    if (this.pos >= this.end) throw new MidiParseError('The file ends unexpectedly.');
    return this.bytes[this.pos++];
  }

  u16(): number {
    return (this.u8() << 8) | this.u8();
  }

  u32(): number {
    return ((this.u16() << 16) | this.u16()) >>> 0;
  }

  vlq(): number {
    let n = 0;
    for (let i = 0; i < 4; i++) {
      const b = this.u8();
      n = (n << 7) | (b & 0x7f);
      if (!(b & 0x80)) return n;
    }
    throw new MidiParseError('Malformed variable-length number.');
  }

  take(len: number): Uint8Array {
    if (this.pos + len > this.end) throw new MidiParseError('The file ends unexpectedly.');
    const out = this.bytes.subarray(this.pos, this.pos + len);
    this.pos += len;
    return out;
  }

  tag(): string {
    return String.fromCharCode(...this.take(4));
  }
}

export function decodeMidi(data: ArrayBuffer): MidiSong {
  const bytes = new Uint8Array(data);
  const r = new Reader(bytes);
  if (bytes.length < 14 || r.tag() !== 'MThd') throw new MidiParseError('This is not a MIDI file.');
  const headerLen = r.u32();
  const format = r.u16();
  const trackCount = r.u16();
  const division = r.u16();
  r.take(headerLen - 6);
  if (format > 1) throw new MidiParseError('Format 2 MIDI files are not supported.');
  if (division & 0x8000) throw new MidiParseError('SMPTE-timed MIDI files are not supported.');
  const ppq = division || PPQ;

  const notes: (MidiNote & { channel: number })[] = [];
  let name: string | undefined;
  let tempo: { tick: number; mpq: number } | undefined;

  for (let t = 0; t < trackCount && !r.done; t++) {
    const tag = r.tag();
    const len = r.u32();
    if (tag !== 'MTrk') {
      r.take(len); // skip unknown chunks
      t--;
      continue;
    }
    const tr = new Reader(bytes, Math.min(bytes.length, r.pos + len));
    tr.pos = r.pos;
    r.take(Math.min(len, bytes.length - r.pos));

    const open = new Map<number, { tick: number; velocity: number }[]>();
    let tick = 0;
    let status = 0;
    while (!tr.done) {
      tick += tr.vlq();
      let b = tr.u8();
      if (b === 0xff) {
        const type = tr.u8();
        const data = tr.take(tr.vlq());
        if (type === 0x51 && data.length === 3 && (!tempo || tick < tempo.tick)) {
          tempo = { tick, mpq: (data[0] << 16) | (data[1] << 8) | data[2] };
        } else if (type === 0x03 && name === undefined && data.length) {
          name = new TextDecoder().decode(data).trim() || undefined;
        } else if (type === 0x2f) break;
        continue;
      }
      if (b === 0xf0 || b === 0xf7) {
        tr.take(tr.vlq());
        status = 0;
        continue;
      }
      if (b < 0x80) {
        if (!status) throw new MidiParseError('Malformed MIDI event.');
        tr.pos--; // running status: this byte is data
        b = status;
      } else {
        status = b;
      }
      const kind = b & 0xf0;
      const channel = b & 0x0f;
      const d1 = tr.u8();
      const d2 = kind === 0xc0 || kind === 0xd0 ? 0 : tr.u8();
      const key = channel * 128 + d1;
      if (kind === 0x90 && d2 > 0) {
        const stack = open.get(key) ?? [];
        stack.push({ tick, velocity: d2 });
        open.set(key, stack);
      } else if (kind === 0x80 || kind === 0x90) {
        const on = open.get(key)?.shift();
        if (on) notes.push(toNote(d1, channel, on, tick, ppq));
      }
    }
    for (const [key, stack] of open) {
      for (const on of stack) notes.push(toNote(key % 128, Math.floor(key / 128), on, tick, ppq));
    }
  }

  // Drop the drum channel unless that's all there is.
  const pitched = notes.filter((n) => n.channel !== DRUM_CHANNEL);
  const chosen = pitched.length ? pitched : notes;
  return {
    name,
    bpm: tempo ? Math.round((60_000_000 / tempo.mpq) * 100) / 100 : 120,
    notes: chosen
      .map(({ channel: _channel, ...n }) => n)
      .sort((a, b) => a.start - b.start || a.pitch - b.pitch),
  };
}

function toNote(
  pitch: number,
  channel: number,
  on: { tick: number; velocity: number },
  offTick: number,
  ppq: number,
): MidiNote & { channel: number } {
  return {
    pitch,
    channel,
    start: on.tick / ppq,
    duration: Math.max(1, offTick - on.tick) / ppq,
    velocity: on.velocity,
  };
}
