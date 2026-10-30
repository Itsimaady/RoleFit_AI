// Framework-free lifecycle around the Web Speech API's SpeechRecognition.
//
// Browsers end recognition sessions on their own (silence, network hiccups,
// ~60 s limits) even with continuous = true. This controller:
//   • rebuilds the current session's text from event.results on every event
//     (never appends), so restarts cannot duplicate words;
//   • commits a session's final text (and any unfinalised interim words) when it
//     ends, so nothing the user said is silently dropped;
//   • restarts automatically while the answer is active, with back-off and a
//     hard limit, so it cannot loop forever;
//   • never restarts after the user explicitly stops.

export const FATAL_ERRORS = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported', 'bad-grammar']);

export const ERROR_MESSAGES = {
  'not-allowed': 'Microphone access was blocked. Allow it from the address bar, or type your answer instead.',
  'service-not-allowed': 'This browser does not allow speech recognition here. Type your answer instead.',
  'audio-capture': 'No microphone was found or it stopped working. Check it and try again, or type your answer.',
  'language-not-supported': 'The selected recognition language is not supported by this browser.',
  network: 'Speech recognition lost its network connection.',
  'stopped-unexpectedly': 'Listening stopped repeatedly and could not be resumed. Your transcript so far is kept — edit it or type the rest.',
};

export function getRecognitionClass(win = typeof window !== 'undefined' ? window : undefined) {
  return win?.SpeechRecognition || win?.webkitSpeechRecognition || null;
}

const joinText = (parts) => parts.map((p) => p.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

export function createRecognitionController({ Recognition, lang = 'en-IN', onChange = () => {}, maxRestarts = 6, maxDurationMs = 10 * 60 * 1000, schedule = setTimeout, clear = clearTimeout }) {
  const state = {
    status: 'idle', // idle | listening | restarting | stopped | error
    committed: [], // final text from sessions that have ended
    sessionFinal: '',
    interim: '',
    error: null,
    errors: [],
    restarts: 0,
    restartsWithoutResult: 0,
    limitReached: false,
  };
  let rec = null;
  let active = false; // the answer is in progress (user has not stopped)
  let stopResolvers = [];
  let restartTimer = null;
  let limitTimer = null;

  const snapshot = () => ({
    status: state.status,
    finalText: joinText([...state.committed, state.sessionFinal]),
    interim: state.interim,
    error: state.error,
    errors: [...state.errors],
    restarts: state.restarts,
    limitReached: state.limitReached,
  });
  const emit = () => onChange(snapshot());

  const commitSession = () => {
    // Keep interim words the engine never finalised; losing speech is worse than a rough word.
    const text = joinText([state.sessionFinal, state.interim]);
    if (text) state.committed.push(text);
    state.sessionFinal = '';
    state.interim = '';
  };

  const finishStop = () => {
    clear(limitTimer);
    limitTimer = null;
    const resolvers = stopResolvers;
    stopResolvers = [];
    resolvers.forEach((r) => r(snapshot()));
  };

  const fail = (code) => {
    active = false;
    state.status = 'error';
    state.error = code;
    commitSession();
    emit();
    finishStop();
  };

  const createSession = () => {
    const r = new Recognition();
    r.continuous = true;
    r.interimResults = true;
    r.lang = lang;
    r.maxAlternatives = 1;
    r.onresult = (event) => {
      if (r !== rec) return; // stale session
      let finals = '';
      let interim = '';
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript || '';
        if (result.isFinal) finals += ` ${text}`;
        else interim += ` ${text}`;
      }
      state.sessionFinal = joinText([finals]);
      state.interim = joinText([interim]);
      state.restartsWithoutResult = 0;
      emit();
    };
    r.onerror = (event) => {
      if (r !== rec) return;
      const code = event?.error || 'unknown';
      if (!state.errors.includes(code)) state.errors.push(code);
      if (FATAL_ERRORS.has(code)) fail(code);
      // Other errors (no-speech, aborted, network) are followed by onend, which decides.
    };
    r.onend = () => {
      if (r !== rec) return;
      commitSession();
      if (!active) {
        state.status = state.status === 'error' ? 'error' : 'stopped';
        emit();
        finishStop();
        return;
      }
      state.restartsWithoutResult += 1;
      if (state.restartsWithoutResult > maxRestarts) {
        fail(state.errors.includes('network') ? 'network' : 'stopped-unexpectedly');
        return;
      }
      state.status = 'restarting';
      state.restarts += 1;
      emit();
      const delay = Math.min(2000, 150 * state.restartsWithoutResult);
      restartTimer = schedule(() => {
        restartTimer = null;
        if (!active) return;
        beginSession();
      }, delay);
    };
    return r;
  };

  function beginSession() {
    rec = createSession();
    try {
      rec.start();
      state.status = 'listening';
      emit();
    } catch (err) {
      // InvalidStateError if a session is somehow still running; treat as an end.
      rec.onend?.();
    }
  }

  return {
    get state() {
      return snapshot();
    },
    /** Start listening. keepExisting appends to the current transcript ("Resume listening"). */
    start({ keepExisting = false } = {}) {
      if (!Recognition) throw new Error('Speech recognition is not supported in this browser.');
      if (active) return;
      if (!keepExisting) {
        state.committed = [];
        state.errors = [];
        state.restarts = 0;
      }
      state.sessionFinal = '';
      state.interim = '';
      state.error = null;
      state.limitReached = false;
      state.restartsWithoutResult = 0;
      active = true;
      clear(limitTimer);
      limitTimer = schedule(() => {
        state.limitReached = true;
        this.stop();
      }, maxDurationMs);
      beginSession();
    },
    /** Explicit stop: resolves with the final snapshot once the engine has flushed its results. */
    stop() {
      const wasActive = active;
      active = false;
      clear(restartTimer);
      restartTimer = null;
      const done = new Promise((resolve) => stopResolvers.push(resolve));
      if (!wasActive || !rec) {
        commitSession();
        if (state.status !== 'error') state.status = 'stopped';
        emit();
        finishStop();
        return done;
      }
      try {
        rec.stop();
      } catch {
        rec.onend?.();
      }
      // Some engines never fire onend after stop(); do not hang the UI.
      schedule(() => {
        if (stopResolvers.length) {
          rec = null;
          commitSession();
          if (state.status !== 'error') state.status = 'stopped';
          emit();
          finishStop();
        }
      }, 1500);
      return done;
    },
    /** Hard cancel (unmount / skip): no further events are processed. */
    abort() {
      active = false;
      clear(restartTimer);
      clear(limitTimer);
      const r = rec;
      rec = null;
      try {
        r?.abort();
      } catch {
        /* already stopped */
      }
      commitSession();
      state.status = 'stopped';
      finishStop();
    },
    /** Replace the transcript (e.g. after manual edits) before resuming. */
    setText(text) {
      state.committed = text.trim() ? [text.trim()] : [];
      state.sessionFinal = '';
      state.interim = '';
      emit();
    },
  };
}
