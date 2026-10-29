// Guided interview UI flow with scripted SpeechRecognition / speechSynthesis
// stand-ins and a mocked API. Verifies the state machine and the data sent —
// not real browser speech quality.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { routes } from '../App.jsx';
import { mockApi, renderRoutes, testUser } from './utils.jsx';
import { createSegmentStats, measureFrame } from '../features/interview/speech/cameraCoaching.js';
import { inputMethodFor } from '../features/interview/guidedModel.js';

let recognitions;
let spoken;
let currentUtterance;

function installSpeech({ recognition = true, synthesis = true } = {}) {
  recognitions = [];
  spoken = [];
  class FakeRecognition {
    constructor() {
      recognitions.push(this);
    }
    start() {
      this.started = true;
    }
    stop() {
      this.stopped = true;
      queueMicrotask(() => this.onend?.());
    }
    abort() {
      this.aborted = true;
    }
    say(list) {
      this.onresult?.({ results: list.map(([t, f]) => Object.assign([{ transcript: t }], { isFinal: f })) });
    }
  }
  window.webkitSpeechRecognition = recognition ? FakeRecognition : undefined;
  window.SpeechRecognition = undefined;
  if (synthesis) {
    window.SpeechSynthesisUtterance = class {
      constructor(text) {
        this.text = text;
      }
    };
    window.speechSynthesis = {
      speak(u) {
        spoken.push(u.text);
        currentUtterance = u;
      },
      cancel() {
        const u = currentUtterance;
        currentUtterance = null;
        u?.onerror?.({ error: 'interrupted' });
      },
      getVoices: () => [],
      addEventListener() {},
      removeEventListener() {},
    };
  } else {
    window.speechSynthesis = undefined;
    window.SpeechSynthesisUtterance = undefined;
  }
}

const finishSpeaking = () =>
  act(async () => {
    const u = currentUtterance;
    currentUtterance = null;
    u?.onend?.();
  });

/** Text of the question currently shown in the main panel. */
const currentQuestion = () => document.querySelector('.question-panel .q')?.textContent;

const QUESTIONS = ['Explain what a REST API is.', 'How does a hash map work?', 'Describe a bug you fixed.'].map((q) => ({ question: q, category: 'Backend Development', difficulty: 'Medium' }));

function sessionApi({ evaluation = { score: 7, strengths: ['Clear'], improvements: ['Add an example'], example_answer: 'x' }, ...overrides } = {}) {
  const posted = [];
  const session = { _id: 's1', mode: 'guided', status: 'ready', config: { category: 'Backend Development', difficulty: 'Medium', questionCount: 3, visualCoaching: false }, targetRole: 'Backend Intern', questions: QUESTIONS, responses: [], ...overrides };
  const api = mockApi({
    'GET /api/auth/me': () => [200, { user: testUser }],
    'GET /api/interviews/s1': () => [200, { session }],
    'POST /api/interviews/s1/responses': ({ body }) => {
      posted.push(body);
      return [201, { response: { ...body, evaluation: body.status === 'answered' ? evaluation : null, evaluationError: body.status === 'answered' && !evaluation ? 'The AI could not produce a valid answer evaluation.' : null }, answeredCount: posted.length, total: 3 }];
    },
    'POST /api/interviews/s1/complete': () => [200, { session: { ...session, status: 'completed' } }],
  });
  return { ...api, posted };
}

beforeEach(() => installSpeech());
afterEach(() => {
  delete window.webkitSpeechRecognition;
  delete window.speechSynthesis;
  delete window.SpeechSynthesisUtterance;
});

describe('guided interview flow', () => {
  it('speaks, listens only after speech ends, keeps listening through pauses and submits only on Stop + Submit', async () => {
    const { posted } = sessionApi();
    renderRoutes(routes, '/app/interviews/s1/guided');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /start interview/i }));

    // Question is shown and spoken; no recording while the interviewer speaks.
    expect(currentQuestion()).toBe('Explain what a REST API is.');
    expect(spoken).toEqual(['Explain what a REST API is.']);
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('Interviewer speaking');
    expect(recognitions).toHaveLength(0);

    await finishSpeaking();
    expect(recognitions).toHaveLength(1);
    expect(recognitions[0]).toMatchObject({ started: true, continuous: true, interimResults: true });
    expect(screen.getByText(/Listening to your answer/)).toBeInTheDocument();

    // Interim then final text; a pause (engine ends session) auto-resumes.
    act(() => recognitions[0].say([['REST uses HTTP', false]]));
    expect(screen.getByText('REST uses HTTP')).toBeInTheDocument();
    act(() => recognitions[0].say([['REST uses HTTP verbs', true]]));
    await act(async () => {
      recognitions[0].onend();
      await new Promise((r) => setTimeout(r, 200));
    });
    expect(recognitions).toHaveLength(2);
    act(() => recognitions[1].say([['on resources', true]]));
    expect(posted).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: /stop answer/i }));
    await user.click(await screen.findByRole('button', { name: /submit answer/i }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ index: 0, status: 'answered', transcript: 'REST uses HTTP verbs on resources', inputMethod: 'voice', recognition: { restarts: 1 } });
    await waitFor(() => expect(document.querySelector('.feedback-panel .score-pill')?.textContent).toBe('7/10'));
    expect(screen.getByText(/AI feedback · approximate/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /next question/i }));
    expect(currentQuestion()).toBe('How does a hash map work?');
    expect(spoken.at(-1)).toBe('How does a hash map work?');
  }, 15000);

  it('editing the transcript marks it as voice_edited', async () => {
    const { posted } = sessionApi();
    renderRoutes(routes, '/app/interviews/s1/guided');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /start interview/i }));
    await finishSpeaking();
    act(() => recognitions[0].say([['rest is a stile', true]]));
    await user.click(screen.getByRole('button', { name: /stop answer/i }));
    await user.click(await screen.findByRole('button', { name: /edit transcript/i }));
    const box = screen.getByRole('textbox', { name: /your answer/i });
    await user.clear(box);
    await user.type(box, 'REST is a style');
    await user.click(screen.getByRole('button', { name: /submit answer/i }));
    await waitFor(() => expect(posted[0]).toMatchObject({ transcript: 'REST is a style', inputMethod: 'voice_edited' }));
  }, 15000);

  it('skip keeps the partial answer when chosen, is not evaluated, and moves on', async () => {
    const { posted } = sessionApi();
    renderRoutes(routes, '/app/interviews/s1/guided');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /start interview/i }));
    await finishSpeaking();
    act(() => recognitions[0].say([['I am not sure but', true]]));
    await user.click(screen.getByRole('button', { name: /skip question/i }));
    const dialog = await screen.findByRole('dialog', { name: /skip this question/i });
    await user.click(within(dialog).getByRole('button', { name: /skip and keep what i said/i }));
    await waitFor(() => expect(posted[0]).toMatchObject({ index: 0, status: 'skipped_for_learning', transcript: 'I am not sure but' }));
    await waitFor(() => expect(currentQuestion()).toBe('How does a hash map work?'));
    expect(screen.queryByText(/\/10/)).not.toBeInTheDocument();
  }, 15000);

  it('cancelling the skip dialog (Escape) never discards the answer', async () => {
    const { posted } = sessionApi();
    renderRoutes(routes, '/app/interviews/s1/guided');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /start interview/i }));
    await finishSpeaking();
    act(() => recognitions[0].say([['partial words', true]]));
    await user.click(screen.getByRole('button', { name: /skip question/i }));
    await screen.findByRole('dialog', { name: /skip this question/i });
    await user.keyboard('{Escape}');
    expect(posted).toHaveLength(0);
    expect(screen.getByText('partial words')).toBeInTheDocument();
  }, 15000);

  it('an empty answer is never submitted silently', async () => {
    const { posted } = sessionApi();
    renderRoutes(routes, '/app/interviews/s1/guided');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /start interview/i }));
    await finishSpeaking();
    await user.click(screen.getByRole('button', { name: /stop answer/i }));
    await user.click(await screen.findByRole('button', { name: /submit answer/i }));
    const dialog = await screen.findByRole('dialog', { name: /no answer was captured/i });
    expect(posted).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: /record empty answer/i }));
    await waitFor(() => expect(posted[0]).toMatchObject({ status: 'answered_but_empty', transcript: '' }));
  }, 15000);

  it('falls back to typing when speech recognition and synthesis are unsupported', async () => {
    installSpeech({ recognition: false, synthesis: false });
    const { posted } = sessionApi();
    renderRoutes(routes, '/app/interviews/s1/guided');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /start interview/i }));
    expect(screen.queryByRole('button', { name: /stop answer/i })).not.toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: /your answer/i }), 'Typed answer');
    await user.click(screen.getByRole('button', { name: /submit answer/i }));
    await waitFor(() => expect(posted[0]).toMatchObject({ status: 'answered', transcript: 'Typed answer', inputMethod: 'typed' }));
  }, 15000);

  it('keeps the answer and offers a retry when evaluation fails', async () => {
    sessionApi({ evaluation: null });
    renderRoutes(routes, '/app/interviews/s1/guided');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /start interview/i }));
    await finishSpeaking();
    act(() => recognitions[0].say([['my answer', true]]));
    await user.click(screen.getByRole('button', { name: /stop answer/i }));
    await user.click(await screen.findByRole('button', { name: /submit answer/i }));
    expect(await screen.findByText(/evaluation is pending/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry evaluation/i })).toBeInTheDocument();
    expect(screen.getByText('my answer')).toBeInTheDocument();
  }, 15000);

  it('completes after the configured number of questions', async () => {
    const api = sessionApi({ responses: [{ index: 0, status: 'answered' }, { index: 1, status: 'skipped_for_learning' }] });
    const { router } = renderRoutes(routes, '/app/interviews/s1/guided');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /resume interview/i }));
    expect(currentQuestion()).toBe('Describe a bug you fixed.');
    await finishSpeaking();
    act(() => recognitions[0].say([['fixed a race', true]]));
    await user.click(screen.getByRole('button', { name: /stop answer/i }));
    await user.click(await screen.findByRole('button', { name: /submit answer/i }));
    await user.click(await screen.findByRole('button', { name: /finish & see report/i }));
    await waitFor(() => expect(api.calls.some((c) => c.path === '/api/interviews/s1/complete')).toBe(true));
    await waitFor(() => expect(router.state.location.pathname).toBe('/app/interviews/s1'));
  }, 15000);
});

describe('guided report', () => {
  const report = {
    _id: 's1',
    mode: 'guided',
    status: 'completed',
    completedAt: '2026-10-30T10:00:00Z',
    targetRole: 'Backend Intern',
    config: { category: 'Backend Development', difficulty: 'Medium', questionCount: 3 },
    questions: QUESTIONS,
    responses: [
      { index: 0, status: 'answered', transcript: 'REST answer', evaluation: { score: 4, strengths: ['Clear'], example_answer: 'A stronger answer…' } },
      { index: 1, status: 'skipped_for_learning', transcript: '', learning: null, learningError: 'The AI could not produce a valid learning answer.' },
      { index: 2, status: 'answered_but_empty', transcript: '' },
    ],
    report: {
      counts: { configured: 3, asked: 3, notAsked: 0, answered: 1, evaluated: 1, evaluationPending: 0, skipped: 1, empty: 1, technicalError: 0 },
      averageScore: 4,
      scoreMethod: 'Only evaluated answers are averaged.',
      byCategory: [{ category: 'Backend Development', asked: 3, skipped: 1, evaluated: 1, averageScore: 4 }],
      weakIndices: [0],
      skippedIndices: [1],
      speaking: { voiceAnswers: 1, typedAnswers: 0, editedTranscripts: 0, answersWithRecognitionRestarts: 0, recognitionErrors: [] },
      visual: { enabled: false },
      summary: { strengths: ['Clear explanations'], improvements: [], recommendations: [], ai_used: true },
    },
  };

  it('shows counts, blocks an incomplete PDF and offers practice actions', async () => {
    mockApi({ 'GET /api/auth/me': () => [200, { user: testUser }], 'GET /api/interviews/s1': () => [200, { session: report }] });
    renderRoutes(routes, '/app/interviews/s1');
    expect(await screen.findByText(/Average 4\/10 across 1 evaluated answer\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /download pdf report/i })).toBeDisabled();
    expect(screen.getByText(/Learning answers for 1 skipped question are not ready/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /practice skipped questions/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry weak questions/i })).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /questions i need to learn/i }));
    expect(screen.getByText('How does a hash map work?')).toBeInTheDocument();
  });
});

describe('pure helpers', () => {
  it('camera coaching measures framing and orientation only, with unavailable states', () => {
    expect(measureFrame(undefined)).toEqual({ face: false });
    const face = Array.from({ length: 300 }, () => ({ x: 0.5, y: 0.5 }));
    face[33] = { x: 0.4, y: 0.4 };
    face[263] = { x: 0.6, y: 0.4 };
    face[1] = { x: 0.5, y: 0.5 };
    expect(measureFrame(face)).toEqual({ face: true, inFrame: true, facing: true });
    const turned = face.map((p) => ({ ...p }));
    turned[1] = { x: 0.59, y: 0.5 };
    expect(measureFrame(turned).facing).toBe(false);

    const stats = createSegmentStats({ lookAwayFrames: 2 });
    [{ face: false }, { face: true, inFrame: true, facing: true }, { face: true, inFrame: true, facing: false }, { face: true, inFrame: true, facing: false }, { face: true, inFrame: false, facing: false }].forEach(stats.add);
    expect(stats.result()).toEqual({ samples: 5, faceInFramePct: 60, facingCameraPct: 25, lookAwayEvents: 1, faceDetectedPct: 80 });
    expect(createSegmentStats().result().faceInFramePct).toBe(null);
    const noFace = createSegmentStats();
    [{ face: false }, { face: false }].forEach(noFace.add);
    expect(noFace.result()).toMatchObject({ samples: 2, faceInFramePct: null, facingCameraPct: null });
  });

  it('classifies how an answer was produced', () => {
    expect(inputMethodFor({ recognized: '', final: 'typed', usedVoice: false })).toBe('typed');
    expect(inputMethodFor({ recognized: 'spoken', final: 'spoken', usedVoice: true })).toBe('voice');
    expect(inputMethodFor({ recognized: 'spokn', final: 'spoken', usedVoice: true })).toBe('voice_edited');
  });
});

vi.setConfig({ testTimeout: 15000 });
