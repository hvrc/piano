import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5190, strictPort: true },
  // The audio-transcription model (TensorFlow.js + Basic Pitch, ~1 MB) is its own chunk, loaded
  // only when someone transcribes; it's expected to be big.
  build: { chunkSizeWarningLimit: 1100 },
});
