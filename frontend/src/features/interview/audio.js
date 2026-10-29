// Audio helpers for the Gemini Live session (ported from the original
// RoleFit interview screen): 16 kHz PCM capture and 24 kHz PCM playback.

export const INPUT_RATE = 16000;
export const OUTPUT_RATE = 24000;

/** Averaging downsampler from the AudioContext rate to 16 kHz mono. */
export function downsample(buffer, inRate) {
  if (inRate === INPUT_RATE) return new Float32Array(buffer);
  const ratio = inRate / INPUT_RATE;
  const outLen = Math.round(buffer.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), buffer.length);
    let sum = 0;
    let n = 0;
    for (let j = start; j < end; j++) {
      sum += buffer[j];
      n++;
    }
    out[i] = n ? sum / n : 0;
  }
  return out;
}

/** Float32 [-1, 1] -> little-endian 16-bit PCM, base64 encoded. */
export function pcmBase64(float32) {
  const buf = new ArrayBuffer(float32.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < float32.length; i++) {
    const x = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  let bin = '';
  const u8 = new Uint8Array(buf);
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, Math.min(i + 0x8000, u8.length)));
  return btoa(bin);
}

/**
 * Accumulates small worklet frames into ~40 ms chunks before sending, instead
 * of one WebSocket message per 128-sample render quantum.
 */
export function createChunker(onChunk, chunkSamples = 640) {
  let pending = [];
  let size = 0;
  return {
    push(samples) {
      pending.push(samples);
      size += samples.length;
      if (size < chunkSamples) return;
      const merged = new Float32Array(size);
      let offset = 0;
      for (const part of pending) {
        merged.set(part, offset);
        offset += part.length;
      }
      pending = [];
      size = 0;
      onChunk(merged);
    },
    reset() {
      pending = [];
      size = 0;
    },
  };
}

/** Gapless scheduler for streamed 24 kHz PCM from Gemini. */
export function createPcmPlayer(ctx, onSpeakingChange) {
  const sources = new Set();
  let playhead = 0;
  return {
    play(b64) {
      const raw = atob(b64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      const samples = new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
      const buffer = ctx.createBuffer(1, samples.length, OUTPUT_RATE);
      const channel = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) channel[i] = samples[i] / 32768;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      sources.add(src);
      playhead = Math.max(playhead, ctx.currentTime);
      src.start(playhead);
      playhead += buffer.duration;
      onSpeakingChange(true);
      src.onended = () => {
        sources.delete(src);
        if (!sources.size) onSpeakingChange(false);
      };
    },
    /** Barge-in: stop everything that is queued. */
    stop() {
      sources.forEach((s) => {
        try {
          s.stop();
        } catch {
          /* already stopped */
        }
      });
      sources.clear();
      playhead = 0;
      onSpeakingChange(false);
    },
  };
}

const FILLERS = /\b(um+|uh+|like|actually|basically|you know)\b/gi;

/**
 * Transcript-based delivery heuristic (word count and filler words).
 * Approximate by design: transcription errors affect it.
 */
export function deliveryHeuristic(text) {
  const words = (text.trim().match(/\b[\w']+\b/g) || []).length;
  if (!words) return null;
  const fillers = (text.match(FILLERS) || []).length;
  return Math.max(0, Math.min(100, Math.round(45 + Math.min(45, words * 1.2) - fillers * 5)));
}
