import { describe, expect, it } from 'vitest';
import { createRecognitionController } from '../features/interview/speech/recognitionController.js';

/** Scriptable stand-in for the browser SpeechRecognition engine. */
function makeFake() {
  const instances = [];
  class FakeRecognition {
    constructor() {
      this.started = false;
      instances.push(this);
    }
    start() {
      if (this.started) throw new Error('InvalidStateError');
      this.started = true;
    }
    stop() {
      this.ended = true;
      this.onend?.();
    }
    abort() {
      this.ended = true;
    }
    // helpers
    results(list) {
      const results = list.map(([text, isFinal]) => Object.assign([{ transcript: text }], { isFinal }));
      this.onresult?.({ results });
    }
    error(code) {
      this.onerror?.({ error: code });
    }
    end() {
      this.onend?.();
    }
  }
  return { FakeRecognition, instances };
}

/** Manual clock so restarts and timeouts are deterministic. */
function makeClock() {
  let id = 0;
  const timers = new Map();
  return {
    schedule: (fn, ms) => {
      timers.set(++id, { fn, ms });
      return id;
    },
    clear: (t) => timers.delete(t),
    runAll() {
      const pending = [...timers.entries()].filter(([, t]) => t.ms < 60000);
      pending.forEach(([k]) => timers.delete(k));
      pending.forEach(([, t]) => t.fn());
    },
    fireLimit() {
      const limit = [...timers.entries()].find(([, t]) => t.ms >= 60000);
      if (limit) {
        timers.delete(limit[0]);
        limit[1].fn();
      }
    },
  };
}

function setup(opts = {}) {
  const { FakeRecognition, instances } = makeFake();
  const clock = makeClock();
  const changes = [];
  const ctrl = createRecognitionController({ Recognition: FakeRecognition, onChange: (s) => changes.push(s), schedule: clock.schedule, clear: clock.clear, ...opts });
  return { ctrl, instances, clock, changes, last: () => changes.at(-1) };
}

describe('speech recognition controller', () => {
  it('configures continuous recognition with interim results and the chosen language', () => {
    const { ctrl, instances } = setup({ lang: 'en-US' });
    ctrl.start();
    expect(instances[0]).toMatchObject({ continuous: true, interimResults: true, lang: 'en-US', started: true });
    expect(ctrl.state.status).toBe('listening');
  });

  it('shows interim text immediately and keeps finalised text separately', () => {
    const { ctrl, instances, last } = setup();
    ctrl.start();
    instances[0].results([['I would use', false]]);
    expect(last()).toMatchObject({ finalText: '', interim: 'I would use' });
    instances[0].results([['I would use a hash map', true], ['because', false]]);
    expect(last()).toMatchObject({ finalText: 'I would use a hash map', interim: 'because' });
  });

  it('does not duplicate text when the browser repeats results in later events', () => {
    const { ctrl, instances, last } = setup();
    ctrl.start();
    instances[0].results([['one', true]]);
    instances[0].results([['one', true], ['two', true]]);
    instances[0].results([['one', true], ['two', true], ['three', false]]);
    expect(last().finalText).toBe('one two');
    expect(last().interim).toBe('three');
  });

  it('a natural pause (engine ends the session) restarts listening and keeps earlier text once', () => {
    const { ctrl, instances, clock, last } = setup();
    ctrl.start();
    instances[0].results([['first part', true]]);
    instances[0].error('no-speech');
    instances[0].end();
    expect(last().status).toBe('restarting');
    clock.runAll();
    expect(instances).toHaveLength(2);
    expect(ctrl.state.status).toBe('listening');
    instances[1].results([['second part', true]]);
    expect(last().finalText).toBe('first part second part');
    expect(last().restarts).toBe(1);
  });

  it('keeps unfinalised interim words when a session ends unexpectedly', () => {
    const { ctrl, instances, last } = setup();
    ctrl.start();
    instances[0].results([['the answer is', true], ['binary search', false]]);
    instances[0].end();
    expect(last().finalText).toBe('the answer is binary search');
  });

  it('explicit stop resolves with the final transcript and never restarts', async () => {
    const { ctrl, instances, clock } = setup();
    ctrl.start();
    instances[0].results([['done', true]]);
    const final = await ctrl.stop();
    expect(final).toMatchObject({ status: 'stopped', finalText: 'done' });
    clock.runAll();
    expect(instances).toHaveLength(1);
  });

  it('stop still resolves if the engine never fires onend', async () => {
    const { ctrl, instances, clock } = setup();
    ctrl.start();
    instances[0].stop = () => {}; // engine ignores stop
    instances[0].results([['kept', false]]);
    const pending = ctrl.stop();
    clock.runAll();
    await expect(pending).resolves.toMatchObject({ status: 'stopped', finalText: 'kept' });
  });

  it('stops retrying after repeated failures without results (no infinite loop) and keeps text', () => {
    const { ctrl, instances, clock, last } = setup({ maxRestarts: 3 });
    ctrl.start();
    instances[0].results([['partial answer', true]]);
    for (let i = 0; i < 10; i++) {
      instances.at(-1).end();
      clock.runAll();
    }
    expect(instances.length).toBe(4); // initial + 3 restarts
    expect(last()).toMatchObject({ status: 'error', error: 'stopped-unexpectedly', finalText: 'partial answer' });
  });

  it('a result resets the restart budget, so long answers with many pauses keep working', () => {
    const { ctrl, instances, clock, last } = setup({ maxRestarts: 2 });
    ctrl.start();
    for (let i = 0; i < 6; i++) {
      instances.at(-1).results([[`part${i}`, true]]);
      instances.at(-1).end();
      clock.runAll();
    }
    expect(last().status).toBe('listening');
    expect(last().finalText).toBe('part0 part1 part2 part3 part4 part5');
  });

  it('fatal errors (permission denied) stop immediately and are reported', () => {
    const { ctrl, instances, clock, last } = setup();
    ctrl.start();
    instances[0].results([['before', true]]);
    instances[0].error('not-allowed');
    instances[0].end();
    clock.runAll();
    expect(instances).toHaveLength(1);
    expect(last()).toMatchObject({ status: 'error', error: 'not-allowed', finalText: 'before' });
  });

  it('resume listening appends; a fresh start (retry) clears', () => {
    const { ctrl, instances, last } = setup();
    ctrl.start();
    instances[0].results([['first', true]]);
    ctrl.stop();
    ctrl.start({ keepExisting: true });
    instances[1].results([['second', true]]);
    expect(last().finalText).toBe('first second');
    ctrl.stop();
    ctrl.start();
    expect(ctrl.state.finalText).toBe('');
  });

  it('the safety time limit stops listening and flags it', async () => {
    const { ctrl, instances, clock } = setup();
    ctrl.start();
    instances[0].results([['long answer', true]]);
    clock.fireLimit();
    expect(ctrl.state).toMatchObject({ status: 'stopped', limitReached: true, finalText: 'long answer' });
  });

  it('ignores events from a stale session after abort', () => {
    const { ctrl, instances, last } = setup();
    ctrl.start();
    ctrl.abort();
    const before = last();
    instances[0].results([['ghost words', true]]);
    expect(last()).toBe(before);
  });
});
