import { describe, expect, it } from 'vitest';
import { chunkTimeoutMs, createSpeaker, splitForSpeech } from '../features/interview/speech/speaker.js';

function fakeSynth() {
  const spoken = [];
  let current = null;
  const synth = {
    speak(u) {
      spoken.push(u.text);
      current = u;
    },
    cancel() {
      const u = current;
      current = null;
      u?.onerror?.({ error: 'interrupted' });
    },
    getVoices: () => [{ name: 'Test', lang: 'en-IN' }],
    finish() {
      const u = current;
      current = null;
      u?.onend?.();
    },
  };
  class Utterance {
    constructor(text) {
      this.text = text;
    }
  }
  return { synth, Utterance, spoken };
}

describe('question speaker', () => {
  it('splits long questions into sentence chunks', () => {
    expect(splitForSpeech('First sentence. Second one? Third!')).toEqual(['First sentence.', 'Second one?', 'Third!']);
    const long = `${'word '.repeat(80)}end.`;
    expect(splitForSpeech(long).every((c) => c.length <= 180)).toBe(true);
    expect(splitForSpeech(long).join(' ')).toBe(long.replace(/\s+/g, ' ').trim());
  });

  it('speaks every chunk in order and resolves done', async () => {
    const { synth, Utterance, spoken } = fakeSynth();
    const s = createSpeaker({ synth, Utterance });
    const p = s.speak('Explain hashing. Give an example.', { rate: 1.1 });
    synth.finish();
    synth.finish();
    await expect(p).resolves.toBe('done');
    expect(spoken).toEqual(['Explain hashing.', 'Give an example.']);
  });

  it('a new question cancels the previous one (no overlap, no duplicate playback)', async () => {
    const { synth, Utterance, spoken } = fakeSynth();
    const s = createSpeaker({ synth, Utterance });
    const first = s.speak('Question one. Part two.');
    const second = s.speak('Question two.');
    await expect(first).resolves.toBe('cancelled');
    synth.finish();
    await expect(second).resolves.toBe('done');
    expect(spoken).toEqual(['Question one.', 'Question two.']);
  });

  it('reports unsupported browsers instead of pretending to speak', async () => {
    const s = createSpeaker({ synth: undefined, Utterance: undefined });
    expect(s.supported).toBe(false);
    await expect(s.speak('Hello')).resolves.toBe('unsupported');
  });

  it('does not hang when the engine never reports the end of speech', async () => {
    const { synth, Utterance } = fakeSynth();
    let fire;
    const s = createSpeaker({ synth, Utterance, schedule: (fn) => ((fire = fn), 1), clear: () => {} });
    const p = s.speak('A question the engine never finishes.');
    fire(); // watchdog elapses with no onend/onerror from the engine
    await expect(p).resolves.toBe('error');
    expect(chunkTimeoutMs('one two three', 1)).toBeGreaterThan(4000);
    expect(chunkTimeoutMs('one two three', 0.7)).toBeGreaterThan(chunkTimeoutMs('one two three', 1.4));
  });
});
