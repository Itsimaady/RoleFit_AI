// Guided voice interview API. The AI service is a local stub (helpers.js);
// these tests verify Express contracts, persistence and aggregation — not
// real Gemini output or real speech recognition.
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDatabase, teardownDatabase, clearDatabase, registeredClient, sampleResume, sampleJD, startFakeAiService } from './helpers.js';
import { InterviewSession } from '../src/models/InterviewSession.js';
import { computeGuidedReport, SCORE_METHOD } from '../src/services/interviewReport.js';
import { cleanText } from '../src/services/interviewPdf.js';

let app;
before(async () => {
  app = await setupDatabase();
});
after(teardownDatabase);
beforeEach(clearDatabase);

const binary = (res, cb) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

const config = (extra = {}) => ({ mode: 'guided', difficulty: 'Medium', category: 'Backend Development', questionCount: 5, ...extra });

async function withAi(options, fn) {
  const ai = await startFakeAiService(options);
  try {
    return await fn(ai);
  } finally {
    await ai.stop();
  }
}

async function guided(c, extra) {
  const res = await c.post('/api/interviews').send(config(extra));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.session;
}

const answer = (c, id, index, body) => c.post(`/api/interviews/${id}/responses`).send({ index, ...body });

describe('guided interview configuration', () => {
  it('creates a session with exactly the configured count, difficulty and category', async () => {
    await withAi({}, async (ai) => {
      const c = await registeredClient(app);
      for (const count of [5, 10, 15, 20]) {
        const s = await guided(c, { questionCount: count, difficulty: 'Hard', category: 'System Design' });
        assert.equal(s.mode, 'guided');
        assert.equal(s.questions.length, count);
        assert.equal(s.config.questionCount, count);
        assert.ok(s.questions.every((q) => q.difficulty === 'Hard' && q.category === 'System Design'));
      }
      const call = ai.calls.find((x) => x.path === '/api/interview/guided/questions');
      assert.equal(call.body.difficulty, 'Hard');
      assert.equal(call.body.category, 'System Design');
    });
  });

  it('personalises with the selected resume, job description and optional fields', async () => {
    await withAi({}, async (ai) => {
      const c = await registeredClient(app);
      const { body } = await c.post('/api/resumes').send(sampleResume);
      await guided(c, { resumeId: body.resume._id, jobDescription: sampleJD, targetRole: 'Backend Intern', company: 'Acme', language: 'Python', durationMinutes: 20 });
      const call = ai.calls.find((x) => x.path === '/api/interview/guided/questions');
      assert.match(call.body.resume_text, /Aarav Sharma/);
      assert.equal(call.body.job_description, sampleJD);
      assert.deepEqual([call.body.target_role, call.body.company, call.body.language, call.body.duration_minutes], ['Backend Intern', 'Acme', 'Python', 20]);
    });
  });

  it('allows a general interview without resume or job description', async () => {
    await withAi({}, async (ai) => {
      const c = await registeredClient(app);
      const s = await guided(c, { category: 'General HR' });
      assert.equal(s.resumeTitle, '');
      assert.equal(ai.calls.find((x) => x.path === '/api/interview/guided/questions').body.resume_text, '');
    });
  });

  it('validates count, category and category-specific requirements', async () => {
    await withAi({}, async () => {
      const c = await registeredClient(app);
      assert.equal((await c.post('/api/interviews').send(config({ questionCount: 7 }))).status, 400);
      assert.equal((await c.post('/api/interviews').send(config({ category: 'Astrology' }))).status, 400);
      const resumeBased = await c.post('/api/interviews').send(config({ category: 'Resume-Based Interview' }));
      assert.equal(resumeBased.status, 400);
      assert.ok(resumeBased.body.error.details.some((d) => d.path === 'resumeId'));
      const jdBased = await c.post('/api/interviews').send(config({ category: 'Job Description-Based Interview', jobDescription: 'short' }));
      assert.ok(jdBased.body.error.details.some((d) => d.path === 'jobDescription'));
    });
  });

  it('records Gemini as the question source normally', async () => {
    await withAi({}, async () => {
      const s = await guided(await registeredClient(app));
      assert.equal(s.questionSource, 'gemini');
    });
  });

  it('starts with template fallback questions when Gemini is busy and labels the session', async () => {
    await withAi({ questionSource: 'fallback' }, async () => {
      const c = await registeredClient(app);
      const s = await guided(c, { questionCount: 10 });
      assert.equal(s.questionSource, 'fallback', 'never recorded as Gemini output');
      assert.equal(s.questions.length, 10);
      assert.equal((await InterviewSession.findById(s._id)).questionSource, 'fallback');
      const fetched = await c.get(`/api/interviews/${s._id}`);
      assert.equal(fetched.status, 200);
      assert.equal(fetched.body.session.questionSource, 'fallback');
    });
  });

  it('refuses to start without Gemini instead of inventing questions', async () => {
    await withAi({ geminiConfigured: false }, async () => {
      const c = await registeredClient(app);
      const res = await c.post('/api/interviews').send(config());
      assert.equal(res.status, 503);
      assert.equal(await InterviewSession.countDocuments(), 0);
    });
  });

  it('still creates live-mode sessions when no mode is sent', async () => {
    await withAi({}, async () => {
      const c = await registeredClient(app);
      const { body } = await c.post('/api/resumes').send(sampleResume);
      const res = await c.post('/api/interviews').send({ resumeId: body.resume._id, targetRole: 'Backend Engineer', jobDescription: sampleJD });
      assert.equal(res.status, 201);
      assert.equal(res.body.session.mode, 'live');
      assert.equal(res.body.session.questions.length, 12);
    });
  });
});

describe('guided responses', () => {
  it('evaluates answered questions and never scores skips, empties or technical errors', async () => {
    await withAi({}, async (ai) => {
      const c = await registeredClient(app);
      const s = await guided(c);
      const r0 = await answer(c, s._id, 0, { status: 'answered', transcript: 'An API is… score=8', recognition: { restarts: 2, errors: ['no-speech'] } });
      assert.equal(r0.status, 201);
      assert.equal(r0.body.response.evaluation.score, 8);
      const r1 = await answer(c, s._id, 1, { status: 'skipped_for_learning', transcript: 'I think it is' });
      assert.equal(r1.body.response.evaluation, null);
      await answer(c, s._id, 2, { status: 'answered_but_empty', transcript: '' });
      await answer(c, s._id, 3, { status: 'technical_error', recognition: { errors: ['audio-capture'] } });
      await answer(c, s._id, 4, { status: 'answered', transcript: 'Typed answer score=4', inputMethod: 'typed' });
      assert.equal(ai.calls.filter((x) => x.path === '/api/interview/guided/evaluate').length, 2, 'only answered questions are sent for evaluation');

      const stored = await InterviewSession.findById(s._id).lean();
      assert.deepEqual(stored.responses.map((r) => r.status), ['answered', 'skipped_for_learning', 'answered_but_empty', 'technical_error', 'answered']);
      assert.equal(stored.responses[1].transcript, 'I think it is', 'partial transcript kept for a skip');
      assert.equal(stored.responses[0].recognition.restarts, 2);
    });
  });

  it('enforces order, rejects duplicates and inconsistent statuses', async () => {
    await withAi({}, async () => {
      const c = await registeredClient(app);
      const s = await guided(c);
      assert.equal((await answer(c, s._id, 2, { status: 'answered', transcript: 'x' })).status, 409);
      assert.equal((await answer(c, s._id, 0, { status: 'answered', transcript: '' })).status, 400);
      assert.equal((await answer(c, s._id, 0, { status: 'answered_but_empty', transcript: 'words' })).status, 400);
      assert.equal((await answer(c, s._id, 0, { status: 'answered', transcript: 'ok' })).status, 201);
      assert.equal((await answer(c, s._id, 0, { status: 'answered', transcript: 'again' })).status, 409);
      assert.equal((await answer(c, s._id, 5, { status: 'answered', transcript: 'beyond' })).status, 400, 'cannot exceed the configured count');
    });
  });

  it('keeps the answer when evaluation fails and allows a retry', async () => {
    const c = await registeredClient(app);
    let id;
    await withAi({ failEvaluate: true }, async () => {
      const s = await guided(c);
      id = s._id;
      const res = await answer(c, id, 0, { status: 'answered', transcript: 'My answer score=9' });
      assert.equal(res.status, 201);
      assert.equal(res.body.response.evaluation, null);
      assert.match(res.body.response.evaluationError, /could not produce/);
      const stored = await InterviewSession.findById(id).lean();
      assert.equal(stored.responses[0].transcript, 'My answer score=9', 'the answer is never discarded');
    });
    await withAi({}, async () => {
      const retry = await c.post(`/api/interviews/${id}/responses/0/evaluate`);
      assert.equal(retry.status, 200);
      assert.equal(retry.body.response.evaluation.score, 9);
    });
  });
});

describe('guided report, learning, practice and PDF', () => {
  async function completedSession(c, aiOptions = {}) {
    return withAi(aiOptions, async () => {
      const s = await guided(c, { visualCoaching: true });
      await answer(c, s._id, 0, { status: 'answered', transcript: 'score=8', visual: { samples: 40, faceInFramePct: 95, facingCameraPct: 80, lookAwayEvents: 2 } });
      await answer(c, s._id, 1, { status: 'answered', transcript: 'score=4', inputMethod: 'voice_edited' });
      await answer(c, s._id, 2, { status: 'skipped_for_learning', transcript: '' });
      await answer(c, s._id, 3, { status: 'answered_but_empty', transcript: '' });
      const done = await c.post(`/api/interviews/${s._id}/complete`);
      assert.equal(done.status, 200, JSON.stringify(done.body));
      return done.body.session;
    });
  }

  it('excludes skipped and empty questions from the average and builds learning content', async () => {
    const c = await registeredClient(app);
    const s = await completedSession(c);
    const r = s.report;
    assert.equal(r.averageScore, 6, '(8 + 4) / 2, skip and empty are not zeros');
    assert.deepEqual(r.counts, { configured: 5, asked: 4, notAsked: 1, answered: 2, evaluated: 2, evaluationPending: 0, skipped: 1, empty: 1, technicalError: 0 });
    assert.deepEqual(r.weakIndices, [1]);
    assert.deepEqual(r.skippedIndices, [2]);
    assert.equal(r.scoreMethod, SCORE_METHOD);
    assert.equal(r.summary.ai_used, true);
    assert.equal(r.visual.measuredQuestions, 1);
    assert.equal(r.visual.faceInFramePct, 95);
    assert.equal(r.speaking.editedTranscripts, 1);
    assert.equal(r.speaking.voiceAnswers, 2, 'only answered questions count as voice answers');
    const skipped = s.responses.find((x) => x.index === 2);
    assert.equal(skipped.learning.follow_up_question, 'Next?');
  });

  it('blocks an incomplete PDF until learning answers exist, then regenerates them', async () => {
    const c = await registeredClient(app);
    const s = await completedSession(c, { failLearn: true });
    assert.match(s.responses.find((x) => x.index === 2).learningError, /learning answer/);
    const blocked = await c.get(`/api/interviews/${s._id}/report.pdf`);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error.code, 'learning_incomplete');

    await withAi({}, async () => {
      const regen = await c.post(`/api/interviews/${s._id}/learning`);
      assert.equal(regen.status, 200);
      assert.ok(regen.body.session.responses.find((x) => x.index === 2).learning);
    });
    const pdf = await c.get(`/api/interviews/${s._id}/report.pdf`).buffer(true).parse(binary);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers['content-type'], 'application/pdf');
    assert.match(pdf.headers['content-disposition'], /filename="RoleFit_AI_Interview_Report_Backend_Development\.pdf"/);
    assert.equal(pdf.body.subarray(0, 5).toString(), '%PDF-');
    assert.ok(pdf.body.includes('DejaVuSans'), 'Unicode font is embedded');
  });

  it('starts practice sessions from skipped and weak questions without reconfiguring', async () => {
    const c = await registeredClient(app);
    const s = await completedSession(c);
    await withAi({}, async (ai) => {
      const skipped = await c.post(`/api/interviews/${s._id}/practice`).send({ kind: 'skipped' });
      assert.equal(skipped.status, 201);
      assert.deepEqual(skipped.body.session.questions.map((q) => q.question), [s.questions[2].question]);
      assert.equal(skipped.body.session.config.difficulty, 'Medium');
      assert.equal(skipped.body.session.practiceKind, 'skipped');
      const weak = await c.post(`/api/interviews/${s._id}/practice`).send({ kind: 'weak' });
      assert.deepEqual(weak.body.session.questions.map((q) => q.question), [s.questions[1].question]);
      assert.equal(ai.calls.filter((x) => x.path === '/api/interview/guided/questions').length, 0, 'practice reuses questions');
    });
  });

  it("hides other users' guided sessions and PDFs", async () => {
    const owner = await registeredClient(app);
    const s = await completedSession(owner);
    const intruder = await registeredClient(app);
    assert.equal((await intruder.get(`/api/interviews/${s._id}/report.pdf`)).status, 404);
    assert.equal((await intruder.post(`/api/interviews/${s._id}/practice`).send({ kind: 'skipped' })).status, 404);
    assert.equal((await intruder.post(`/api/interviews/${s._id}/responses`).send({ index: 4, status: 'answered', transcript: 'x' })).status, 404);
  });
});

describe('report helpers', () => {
  it('returns a null average when nothing was evaluated', () => {
    const r = computeGuidedReport({ questions: [{}, {}], responses: [{ index: 0, status: 'skipped_for_learning' }, { index: 1, status: 'technical_error' }], config: {} });
    assert.equal(r.averageScore, null);
    assert.equal(r.counts.technicalError, 1);
    assert.equal(r.visual.enabled, false);
  });

  it('pending evaluations are neither averaged nor called weak', () => {
    const r = computeGuidedReport({ questions: [{}, {}], responses: [{ index: 0, status: 'answered', evaluation: null }, { index: 1, status: 'answered', evaluation: { score: 9 } }], config: {} });
    assert.equal(r.averageScore, 9);
    assert.equal(r.counts.evaluationPending, 1);
    assert.deepEqual(r.weakIndices, []);
  });

  it('PDF text cleaner keeps supported Unicode and replaces unsupported glyphs', () => {
    assert.equal(cleanText('₹500 — “ok” é → ✓'), '₹500 — “ok” é → ✓');
    assert.equal(cleanText('नमस्ते'), '??????');
  });
});
