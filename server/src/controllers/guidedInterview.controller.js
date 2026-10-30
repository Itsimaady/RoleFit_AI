// Guided voice interview: browser speaks questions and transcribes answers;
// the server stores every response and asks the AI service to evaluate it.
import { InterviewSession } from '../models/InterviewSession.js';
import { Resume } from '../models/Resume.js';
import { ApiError } from '../utils/errors.js';
import { aiClient } from '../services/aiClient.js';
import { resumeToText } from '../services/resumeText.js';
import { computeGuidedReport, isEvaluated, WEAK_SCORE_THRESHOLD } from '../services/interviewReport.js';
import { renderInterviewReportPdf } from '../services/interviewPdf.js';
import { safeFilename } from '../services/pdf.service.js';
import { guidedCreateSchema } from '../validators/interview.validators.js';

const ACTIVE = ['ready', 'in_progress'];

async function findGuided(req, { withResumeText = false } = {}) {
  const query = InterviewSession.findOne({ _id: req.valid.params.id, owner: req.user.id });
  if (withResumeText) query.select('+resumeText');
  const session = await query;
  if (!session) throw ApiError.notFound('Interview session not found.');
  if (session.mode !== 'guided') throw ApiError.badRequest('This action is only available for guided interviews.');
  return session;
}

const strip = (session) => {
  const plain = session.toObject ? session.toObject() : session;
  delete plain.resumeText;
  return plain;
};

async function requireGemini() {
  const ai = await aiClient.health();
  if (!ai.reachable) throw ApiError.unavailable('The AI service is not running, so the interview cannot be prepared.', 'ai_service_unavailable');
  if (!ai.geminiConfigured) throw ApiError.unavailable('Gemini is not configured on the AI service, so questions cannot be generated or evaluated.', 'ai_not_configured');
}

async function createSession({ owner, resume, resumeText, config, questions, questionSource = 'gemini', practiceOf, practiceKind }) {
  return InterviewSession.create({
    owner,
    mode: 'guided',
    resume: resume?._id,
    resumeTitle: resume?.title || '',
    resumeText,
    targetRole: config.targetRole,
    jobDescription: config.jobDescription,
    config: {
      questionCount: questions.length,
      mode: 'guided-voice',
      difficulty: config.difficulty,
      category: config.category,
      company: config.company,
      language: config.language,
      durationMinutes: config.durationMinutes,
      visualCoaching: config.visualCoaching,
    },
    questions,
    questionSource,
    practiceOf,
    practiceKind,
  });
}

export async function createGuidedInterview(req, res) {
  const parsed = guidedCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ApiError(400, 'validation_error', 'Please check the highlighted fields.', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  const body = parsed.data;
  let resume = null;
  if (body.resumeId) {
    resume = await Resume.findOne({ _id: body.resumeId, owner: req.user.id }).lean();
    if (!resume) throw ApiError.notFound('Resume not found.');
  }
  await requireGemini();

  const resumeText = resume ? resumeToText(resume) : '';
  const data = await aiClient.json('/api/interview/guided/questions', {
    difficulty: body.difficulty,
    category: body.category,
    count: body.questionCount,
    resume_text: resumeText,
    job_description: body.jobDescription,
    target_role: body.targetRole,
    company: body.company,
    language: body.language,
    duration_minutes: body.durationMinutes,
  });
  const questions = (data.questions || []).map((q) => ({
    question: String(q.question).slice(0, 1000),
    category: String(q.category || body.category).slice(0, 60),
    topic: String(q.topic || '').slice(0, 80),
    difficulty: body.difficulty,
    round: String(q.category || body.category).slice(0, 60),
  }));
  // The configured count is a contract with the user.
  if (questions.length !== body.questionCount) throw new ApiError(502, 'ai_service_error', 'The AI did not return the requested number of questions. Please try again.');

  // 'fallback' = template questions served because Gemini was temporarily unavailable.
  const questionSource = data.source === 'fallback' ? 'fallback' : 'gemini';
  const session = await createSession({ owner: req.user.id, resume, resumeText, config: body, questions, questionSource });
  res.status(201).json({ session: strip(session) });
}

async function evaluateResponse(session, index) {
  const response = session.responses.find((r) => r.index === index);
  const question = session.questions[index];
  try {
    const evaluation = await aiClient.json('/api/interview/guided/evaluate', {
      question: question.question,
      category: question.category || session.config.category,
      difficulty: question.difficulty || session.config.difficulty,
      transcript: response.transcript,
      input_method: response.inputMethod,
      resume_text: session.resumeText || '',
      job_description: session.jobDescription || '',
      target_role: session.targetRole || '',
    });
    await InterviewSession.updateOne(
      { _id: session._id, 'responses.index': index },
      { $set: { 'responses.$.evaluation': evaluation, 'responses.$.evaluationError': null, 'responses.$.evaluatedAt': new Date() } },
    );
    return { evaluation, evaluationError: null };
  } catch (err) {
    // The answer is already saved; record why evaluation is pending so it can be retried.
    const message = err instanceof ApiError ? err.message : 'Evaluation failed.';
    await InterviewSession.updateOne({ _id: session._id, 'responses.index': index }, { $set: { 'responses.$.evaluationError': message } });
    return { evaluation: null, evaluationError: message };
  }
}

export async function submitGuidedResponse(req, res) {
  const body = req.body;
  const session = await findGuided(req, { withResumeText: true });
  if (!ACTIVE.includes(session.status)) throw ApiError.conflict(`This interview is ${session.status.replace('_', ' ')} and no longer accepts answers.`);
  if (body.index >= session.questions.length) throw ApiError.badRequest('Question index is out of range.');
  if (body.index !== session.responses.length) throw new ApiError(409, 'out_of_order', `Expected a response for question ${session.responses.length + 1}.`);

  const record = {
    index: body.index,
    status: body.status,
    transcript: body.transcript,
    inputMethod: body.inputMethod,
    recognition: body.recognition,
    durationSeconds: body.durationSeconds,
    visual: body.visual,
  };
  // Atomic append: only if this index is still the next free slot.
  const guard = { _id: session._id, owner: req.user.id, status: { $in: ACTIVE }, [`responses.${body.index}`]: { $exists: false } };
  if (body.index > 0) guard[`responses.${body.index - 1}`] = { $exists: true };
  const updated = await InterviewSession.findOneAndUpdate(
    guard,
    { $push: { responses: record }, $set: { status: 'in_progress', ...(session.startedAt ? {} : { startedAt: new Date() }) } },
    { new: true },
  ).select('+resumeText');
  if (!updated) throw new ApiError(409, 'out_of_order', 'This question was already recorded.');

  let outcome = { evaluation: null, evaluationError: null };
  if (body.status === 'answered') outcome = await evaluateResponse(updated, body.index);

  res.status(201).json({
    response: { ...record, ...outcome },
    answeredCount: updated.responses.length,
    total: updated.questions.length,
  });
}

export async function retryEvaluation(req, res) {
  const session = await findGuided(req, { withResumeText: true });
  const index = req.valid.params.index;
  const response = session.responses.find((r) => r.index === index);
  if (!response) throw ApiError.notFound('That question has not been answered yet.');
  if (response.status !== 'answered') throw ApiError.badRequest('Only answered questions can be evaluated.');
  if (isEvaluated(response)) return res.json({ response });
  const outcome = await evaluateResponse(session, index);
  if (!outcome.evaluation) throw ApiError.unavailable(outcome.evaluationError || 'Evaluation is still unavailable.', 'evaluation_failed');
  res.json({ response: { ...response.toObject(), ...outcome } });
}

/** Generates learning content for skipped questions that do not have it yet. */
async function fillLearning(session) {
  const pending = session.responses.filter((r) => r.status === 'skipped_for_learning' && !r.learning);
  for (const r of pending) {
    const q = session.questions[r.index];
    try {
      const learning = await aiClient.json('/api/interview/guided/learn', {
        question: q.question,
        category: q.category || session.config.category,
        difficulty: q.difficulty || session.config.difficulty,
        target_role: session.targetRole || '',
        job_description: session.jobDescription || '',
        partial_transcript: r.transcript || '',
      });
      r.learning = learning;
      r.learningError = null;
    } catch (err) {
      r.learningError = err instanceof ApiError ? err.message : 'Learning content could not be generated.';
    }
  }
  return pending.length;
}

async function buildSummary(session) {
  const items = session.responses.map((r) => ({
    question: session.questions[r.index]?.question || '',
    category: session.questions[r.index]?.category || '',
    status: r.status,
    score: isEvaluated(r) ? r.evaluation.score : null,
    strengths: r.evaluation?.strengths || [],
    improvements: r.evaluation?.improvements || [],
    missing_concepts: r.evaluation?.missing_concepts || [],
  }));
  if (!items.length) return null;
  try {
    return await aiClient.json('/api/interview/guided/summary', {
      category: session.config.category,
      difficulty: session.config.difficulty,
      target_role: session.targetRole || '',
      items,
    });
  } catch {
    return null;
  }
}

async function finalize(session) {
  await fillLearning(session);
  const summary = await buildSummary(session);
  session.markModified('responses');
  session.report = { ...computeGuidedReport(session), summary, generatedAt: new Date() };
  return session;
}

export async function completeGuidedInterview(req, res) {
  const session = await findGuided(req, { withResumeText: true });
  if (session.status === 'completed') return res.json({ session: strip(session) });
  if (!ACTIVE.includes(session.status)) throw ApiError.conflict('This interview was ended and cannot be completed.');
  if (!session.responses.length) throw ApiError.badRequest('No questions were answered or skipped, so there is nothing to report.');
  await finalize(session);
  session.status = 'completed';
  session.completedAt = new Date();
  await session.save();
  res.json({ session: strip(session) });
}

/** Retries learning content and refreshes the report for a completed session. */
export async function regenerateLearning(req, res) {
  const session = await findGuided(req, { withResumeText: true });
  if (session.status !== 'completed') throw ApiError.conflict('Finish the interview first.');
  await finalize(session);
  await session.save();
  res.json({ session: strip(session) });
}

export async function startPractice(req, res) {
  const source = await findGuided(req, { withResumeText: true });
  if (source.status !== 'completed') throw ApiError.conflict('Practice sessions can be created from a completed interview.');
  const kind = req.body.kind;
  const picked =
    kind === 'skipped'
      ? source.responses.filter((r) => r.status === 'skipped_for_learning')
      : source.responses.filter((r) => isEvaluated(r) && r.evaluation.score < WEAK_SCORE_THRESHOLD);
  if (!picked.length) throw ApiError.badRequest(kind === 'skipped' ? 'There are no skipped questions to practise.' : `There are no answers scored below ${WEAK_SCORE_THRESHOLD}/10 to retry.`);
  await requireGemini();
  const questions = picked.map((r) => {
    const q = source.questions[r.index];
    return { question: q.question, category: q.category, topic: q.topic, difficulty: q.difficulty, round: q.round };
  });
  const session = await createSession({
    owner: req.user.id,
    resume: source.resume ? { _id: source.resume, title: source.resumeTitle } : null,
    resumeText: source.resumeText,
    config: {
      targetRole: source.targetRole,
      jobDescription: source.jobDescription,
      difficulty: source.config.difficulty,
      category: source.config.category,
      company: source.config.company,
      language: source.config.language,
      durationMinutes: source.config.durationMinutes,
      visualCoaching: source.config.visualCoaching,
    },
    questions,
    questionSource: source.questionSource === 'fallback' ? 'fallback' : 'gemini',
    practiceOf: source._id,
    practiceKind: kind,
  });
  res.status(201).json({ session: strip(session) });
}

export async function downloadReportPdf(req, res) {
  const session = await findGuided(req);
  if (session.status !== 'completed' || !session.report) throw ApiError.conflict('The report is available once the interview is finished.');
  const missing = session.responses.filter((r) => r.status === 'skipped_for_learning' && !r.learning).length;
  if (missing) {
    throw new ApiError(409, 'learning_incomplete', `Learning answers for ${missing} skipped question${missing === 1 ? ' are' : 's are'} not ready yet. Generate them first so the PDF is complete.`);
  }
  const pdf = await renderInterviewReportPdf(session.toObject());
  const name = safeFilename(`RoleFit_AI_Interview_Report_${session.targetRole || session.config.category || ''}`, 'RoleFit_AI_Interview_Report');
  res
    .status(200)
    .set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${name}.pdf"`, 'Content-Length': pdf.length, 'Cache-Control': 'no-store' })
    .send(pdf);
}
