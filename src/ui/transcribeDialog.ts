// "Transcribe audio": record from the microphone (or open an audio file), then turn it into notes.
import { decode, recordMicrophone, transcribe, type TranscribedNote, type TranscribeOptions } from '../audio/transcribe';
import { alertError } from './dialog';

type Stage = 'idle' | 'recording' | 'working';

/** Detection strictness. Tested on a rendered piano: "clean" recovered every note with no extras. */
const SENSITIVITY: Record<string, TranscribeOptions> = {
  clean: { onsetThreshold: 0.7, frameThreshold: 0.4 },
  balanced: { onsetThreshold: 0.6, frameThreshold: 0.35 },
  sensitive: { onsetThreshold: 0.5, frameThreshold: 0.3 },
};

export function openTranscribeDialog(onNotes: (notes: TranscribedNote[], name: string) => void): void {
  const overlay = document.createElement('div');
  overlay.className = 'dialog';
  overlay.innerHTML = `<div class="dialog-card transcribe-card" role="dialog" aria-label="Transcribe audio">
    <h2>Transcribe audio</h2>
    <p>Record a piano (or open an audio file) and it becomes notes you can edit. Transcription happens
      after recording, on this computer — nothing is uploaded. A quiet room and a close microphone help.</p>
    <label class="transcribe-option">Detection
      <select data-act="sensitivity">
        <option value="clean">Clean — fewest extra notes</option>
        <option value="balanced">Balanced</option>
        <option value="sensitive">Sensitive — catches soft notes</option>
      </select>
    </label>
    <div class="transcribe-status" aria-live="polite"></div>
    <div class="dialog-buttons">
      <button class="text" data-act="cancel">Cancel</button>
      <button class="text" data-act="file"><span class="msr" aria-hidden="true">audio_file</span>Open audio file</button>
      <button class="text primary" data-act="record"><span class="msr" aria-hidden="true">mic</span>Record</button>
    </div>
    <input type="file" accept="audio/*" hidden />
  </div>`;
  document.body.append(overlay);
  const status = overlay.querySelector<HTMLElement>('.transcribe-status')!;
  const recordBtn = overlay.querySelector<HTMLButtonElement>('[data-act="record"]')!;
  const fileBtn = overlay.querySelector<HTMLButtonElement>('[data-act="file"]')!;
  const fileInput = overlay.querySelector<HTMLInputElement>('input[type=file]')!;
  const sensitivity = overlay.querySelector<HTMLSelectElement>('[data-act="sensitivity"]')!;
  let stage: Stage = 'idle';
  let mic: Awaited<ReturnType<typeof recordMicrophone>> | null = null;
  let timer = 0;

  const close = () => {
    mic?.cancel();
    window.clearInterval(timer);
    window.removeEventListener('keydown', onKey, true);
    overlay.remove();
  };
  const onKey = (e: KeyboardEvent) => {
    e.stopPropagation(); // keep shortcuts (Space, letters) out while the dialog is open
    if (e.key === 'Escape' && stage !== 'working') close();
  };
  window.addEventListener('keydown', onKey, true);

  const run = async (audio: AudioBuffer, name: string) => {
    stage = 'working';
    recordBtn.disabled = fileBtn.disabled = true;
    status.textContent = 'Listening to the recording… 0%';
    try {
      const notes = await transcribe(
        audio,
        (f) => (status.textContent = `Listening to the recording… ${Math.round(f * 100)}%`),
        SENSITIVITY[sensitivity.value],
      );
      close();
      if (!notes.length) return void alertError('No notes found', 'Try a louder, closer recording of the piano.');
      onNotes(notes, name);
    } catch (err) {
      close();
      await alertError('Couldn’t transcribe that', err instanceof Error ? err.message : String(err));
    }
  };

  overlay.querySelector('[data-act="cancel"]')!.addEventListener('click', () => stage !== 'working' && close());
  fileBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      await run(await decode(await file.arrayBuffer()), file.name.replace(/\.[^.]+$/, ''));
    } catch {
      close();
      await alertError(`Couldn’t open “${file.name}”`, 'The file could not be read as audio.');
    }
  });
  recordBtn.addEventListener('click', async () => {
    if (stage === 'idle') {
      try {
        mic = await recordMicrophone();
      } catch {
        return void (status.textContent = 'Microphone access was blocked. Allow it in the site settings to record.');
      }
      stage = 'recording';
      fileBtn.disabled = true;
      recordBtn.innerHTML = '<span class="msr" aria-hidden="true">stop</span>Stop and transcribe';
      const t0 = performance.now();
      const tick = () => {
        const s = Math.floor((performance.now() - t0) / 1000);
        status.textContent = `● Recording ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      };
      tick();
      timer = window.setInterval(tick, 500);
    } else if (stage === 'recording' && mic) {
      window.clearInterval(timer);
      const audio = await mic.stop();
      mic = null;
      const when = new Date().toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      await run(audio, `Transcription ${when}`);
    }
  });
}
