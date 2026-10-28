// MIDI keyboards over Web MIDI: note on/off with velocity, and the sustain pedal (CC 64).
// Chrome asks for permission the first time; after that, connection is automatic.
import { prefs } from '../state/prefs';
import type { LiveInput } from './liveInput';

export class MidiInput {
  private access: MIDIAccess | null = null;

  constructor(
    private live: LiveInput,
    private onStatus: (text: string, connected: boolean) => void,
  ) {}

  get supported(): boolean {
    return typeof navigator.requestMIDIAccess === 'function';
  }

  /** Connect on load if the user connected before and the permission is still granted. */
  async autoConnect(): Promise<void> {
    if (!this.supported) return this.onStatus('This browser doesn’t support MIDI keyboards (try Chrome or Edge).', false);
    if (!prefs.value.midi) return;
    try {
      const state = await navigator.permissions.query({ name: 'midi' as PermissionName });
      if (state.state === 'granted') await this.connect();
    } catch {
      // permissions.query('midi') unsupported: wait for the user to press Connect
    }
  }

  async connect(): Promise<void> {
    if (!this.supported) return;
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch {
      prefs.set({ midi: false });
      return this.onStatus('MIDI access was blocked. Allow it in the site settings to use a keyboard.', false);
    }
    prefs.set({ midi: true });
    this.access.onstatechange = () => this.attach();
    this.attach();
  }

  private attach(): void {
    if (!this.access) return;
    const names: string[] = [];
    for (const input of this.access.inputs.values()) {
      input.onmidimessage = (e) => e.data && this.handle(e.data);
      if (input.state === 'connected') names.push(input.name ?? 'MIDI keyboard');
    }
    this.onStatus(
      names.length ? `Connected: ${names.join(', ')}.` : 'Ready — plug in a MIDI keyboard and it connects automatically.',
      names.length > 0,
    );
  }

  /** One MIDI message (exposed for testing without hardware). */
  handle(data: Uint8Array): void {
    const [status, d1, d2 = 0] = data;
    const kind = status & 0xf0;
    if (kind === 0x90 && d2 > 0) this.live.noteOn('midi', d1, d2);
    else if (kind === 0x80 || kind === 0x90) this.live.noteOff('midi', d1);
    else if (kind === 0xb0 && d1 === 64) this.live.setPedal(d2 >= 64);
    else if (kind === 0xb0 && (d1 === 120 || d1 === 123)) this.live.allOff(); // all sound / notes off
  }
}
