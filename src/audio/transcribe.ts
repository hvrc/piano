// Audio → notes, after the fact: record (or open) audio, then run Spotify's Basic Pitch model
// (Apache-2.0, runs in the browser via TensorFlow.js). The model and TF.js load only when used.
import { clampVelocity } from '../model/note';

export interface TranscribedNote {
  pitch: number;
  startSec: number;
  durationSec: number;
  velocity: number;
}

const MODEL_RATE = 22050; // Basic Pitch wants 22.05 kHz mono

/** Record from the microphone. Call `stop()` to get the audio. */
export async function recordMicrophone(): Promise<{ stop: () => Promise<AudioBuffer>; cancel: () => void }> {
  // Voice processing would gate and filter the piano, so turn it off.
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.start();
  const end = () => stream.getTracks().forEach((t) => t.stop());
  return {
    stop: () =>
      new Promise((resolve, reject) => {
        recorder.onstop = async () => {
          end();
          try {
            resolve(await decode(await new Blob(chunks).arrayBuffer()));
          } catch (err) {
            reject(err);
          }
        };
        recorder.stop();
      }),
    cancel: () => {
      recorder.onstop = null;
      if (recorder.state !== 'inactive') recorder.stop();
      end();
    },
  };
}

export async function decode(data: ArrayBuffer): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(1, 1, 44100);
  return ctx.decodeAudioData(data);
}

/** Mix to mono and resample to the model's rate. */
async function toModelRate(buffer: AudioBuffer): Promise<AudioBuffer> {
  const length = Math.max(1, Math.ceil(buffer.duration * MODEL_RATE));
  const ctx = new OfflineAudioContext(1, length, MODEL_RATE);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start();
  return ctx.startRendering();
}

export interface TranscribeOptions {
  onsetThreshold: number; // how sure the model must be that a note starts
  frameThreshold: number; // how sure it must be that a note is still sounding
}

export async function transcribe(
  buffer: AudioBuffer,
  onProgress: (fraction: number) => void,
  opts: TranscribeOptions = { onsetThreshold: 0.5, frameThreshold: 0.3 },
): Promise<TranscribedNote[]> {
  const audio = await toModelRate(buffer);
  const { BasicPitch, outputToNotesPoly, addPitchBendsToNoteEvents, noteFramesToTime } = await import('@spotify/basic-pitch');
  const model = new BasicPitch(`${import.meta.env.BASE_URL}models/basic-pitch/model.json`);
  const frames: number[][] = [];
  const onsets: number[][] = [];
  const contours: number[][] = [];
  await model.evaluateModel(
    audio,
    (f, o, c) => {
      frames.push(...f);
      onsets.push(...o);
      contours.push(...c);
    },
    onProgress,
  );
  // ~11 frames ≈ 128 ms minimum note length.
  const raw = outputToNotesPoly(frames, onsets, opts.onsetThreshold, opts.frameThreshold, 11);
  const events = noteFramesToTime(addPitchBendsToNoteEvents(contours, raw));
  return events
    .map((e) => ({
      pitch: e.pitchMidi,
      startSec: e.startTimeSeconds,
      durationSec: e.durationSeconds,
      velocity: clampVelocity(30 + e.amplitude * 97),
    }))
    .sort((a, b) => a.startSec - b.startSec || a.pitch - b.pitch);
}
