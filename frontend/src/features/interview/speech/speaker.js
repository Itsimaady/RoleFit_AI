// Browser text-to-speech for interview questions (speechSynthesis).
// One utterance sequence at a time: a new speak() or cancel() invalidates the
// previous one, so replays and question changes can never overlap. Long text
// is split into sentence-sized chunks because some engines cut off long utterances.

export function splitForSpeech(text, max = 180) {
  const sentences = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .match(/[^.!?]+[.!?]*\s*/g) || [];
  const chunks = [];
  for (const s of sentences) {
    let sentence = s.trim();
    while (sentence.length > max) {
      const cut = sentence.lastIndexOf(' ', max) > 40 ? sentence.lastIndexOf(' ', max) : max;
      chunks.push(sentence.slice(0, cut).trim());
      sentence = sentence.slice(cut).trim();
    }
    if (sentence) chunks.push(sentence);
  }
  return chunks;
}

/** Generous upper bound for how long a chunk can take to speak (ms). */
export function chunkTimeoutMs(text, rate = 1) {
  const words = String(text).split(/\s+/).filter(Boolean).length;
  return Math.round(4000 + (words * 650) / Math.max(0.5, rate));
}

export function createSpeaker({
  synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined,
  Utterance = typeof window !== 'undefined' ? window.SpeechSynthesisUtterance : undefined,
  schedule = setTimeout,
  clear = clearTimeout,
} = {}) {
  const supported = Boolean(synth && Utterance);
  let token = 0;

  return {
    supported,
    /** Resolves 'done' | 'cancelled' | 'error' | 'unsupported'. */
    speak(text, { voice = null, rate = 1, lang = 'en-IN' } = {}) {
      if (!supported) return Promise.resolve('unsupported');
      const mine = ++token;
      synth.cancel();
      const chunks = splitForSpeech(text);
      return new Promise((resolve) => {
        const next = (i) => {
          if (mine !== token) return resolve('cancelled');
          if (i >= chunks.length) return resolve('done');
          const u = new Utterance(chunks[i]);
          u.rate = rate;
          u.lang = voice?.lang || lang;
          if (voice) u.voice = voice;
          let settled = false;
          // Watchdog: some engines never fire onend (no voices yet, headless, idle bugs).
          // Without it the interview would wait forever in "Interviewer speaking".
          const watchdog = schedule(() => {
            if (settled) return;
            settled = true;
            if (mine === token) synth.cancel();
            resolve(mine === token ? 'error' : 'cancelled');
          }, chunkTimeoutMs(chunks[i], rate));
          u.onend = () => {
            if (settled) return;
            settled = true;
            clear(watchdog);
            next(i + 1);
          };
          u.onerror = (e) => {
            if (settled) return;
            settled = true;
            clear(watchdog);
            if (mine !== token) return resolve('cancelled');
            // "interrupted"/"canceled" come from our own cancel(); anything else is a real failure.
            resolve(e?.error === 'interrupted' || e?.error === 'canceled' ? 'cancelled' : 'error');
          };
          synth.speak(u);
        };
        next(0);
      });
    },
    cancel() {
      token++;
      if (supported) synth.cancel();
    },
    voices() {
      return supported ? synth.getVoices() : [];
    },
  };
}
