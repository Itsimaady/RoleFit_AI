import { InterviewSession } from '../models/InterviewSession.js';
import { Resume } from '../models/Resume.js';
import { ApiError } from '../utils/errors.js';
import { aiClient } from '../services/aiClient.js';
import { resumeToText } from '../services/resumeText.js';

const ACTIVE = ['ready', 'in_progress'];

const jobContext = (session) => `Target role: ${session.targetRole}\n\n${session.jobDescription}`;

// Only finite numbers are forwarded; unmeasured signals stay absent instead of becoming 0.
function numericMetrics(vision = {}) {
  return Object.fromEntries(Object.entries(vision).filter(([k, v]) => k !== 'samples' && Number.isFinite(v)));
}

async function findOwned(req, { withResumeText = false } = {}) {
  const query = InterviewSession.findOne({ _id: req.valid.params.id, owner: req.user.id });
  if (withResumeText) query.select('+resumeText');
  const session = await query;
  if (!session) throw ApiError.notFound('Interview session not found.');
  return session;
}

export async function availability(_req, res) {
  const ai = await aiClient.health();
  res.json({
    aiServiceReachable: ai.reachable,
    geminiConfigured: ai.geminiConfigured,
    ready: ai.reachable && ai.geminiConfigured,
    message: !ai.reachable
      ? 'The AI service is not running. Start the Python service in backend/ to enable mock interviews.'
      : !ai.geminiConfigured
        ? 'Gemini is not configured. Add GEMINI_API_KEY to backend/.env and restart the AI service.'
        : 'Mock interviews are available.',
  });
}

export async function createInterview(req, res) {
  const { resumeId, targetRole, jobDescription } = req.body;
  const resume = await Resume.findOne({ _id: resumeId, owner: req.user.id }).lean();
  if (!resume) throw ApiError.notFound('Resume not found.');

  const ai = await aiClient.health();
  if (!ai.reachable) throw ApiError.unavailable('The AI service is not running, so a live interview cannot start.', 'ai_service_unavailable');
  if (!ai.geminiConfigured) throw ApiError.unavailable('Gemini is not configured on the AI service, so a live interview cannot start.', 'ai_not_configured');

  const resumeText = resumeToText(resume);
  const draft = { targetRole, jobDescription };
  const data = await aiClient.json('/api/interview/start', { resume_text: resumeText, job_description: jobContext(draft), question_count: 12 });
  const questions = (data.questions || [])
    .filter((q) => q && typeof q.question === 'string' && q.question.trim())
    .slice(0, 12)
    .map((q) => ({ round: String(q.round || 'Interview').slice(0, 60), difficulty: String(q.difficulty || 'Medium').slice(0, 20), question: q.question.slice(0, 1000) }));
  if (questions.length !== 12) throw new ApiError(502, 'ai_service_error', 'The AI service did not return a complete question set. Please try again.');

  const session = await InterviewSession.create({
    owner: req.user.id,
    resume: resume._id,
    resumeTitle: resume.title,
    resumeText,
    targetRole,
    jobDescription,
    questions,
    questionSource: data.ai_used ? 'gemini' : 'fallback',
  });
  const plain = session.toObject();
  delete plain.resumeText;
  res.status(201).json({ session: plain });
}

export async function submitAnswer(req, res) {
  const { index, answer, vision } = req.body;
  const session = await findOwned(req, { withResumeText: true });
  if (!ACTIVE.includes(session.status)) throw ApiError.conflict(`This interview is ${session.status.replace('_', ' ')} and no longer accepts answers.`);
  if (index !== session.answers.length) throw new ApiError(409, 'out_of_order', `Expected an answer for question ${session.answers.length + 1}.`);
  const question = session.questions[index];
  if (!question) throw ApiError.badRequest('Question index is out of range.');

  const metrics = numericMetrics(vision);
  const result = await aiClient.json('/api/interview/evaluate', {
    question: question.question,
    answer,
    resume_text: session.resumeText,
    job_description: jobContext(session),
    round_name: question.round,
    vision_metrics: metrics,
  });

  const record = {
    index,
    round: question.round,
    question: question.question,
    answer,
    score: Math.max(0, Math.min(100, Math.round(Number(result.score) || 0))),
    feedback: String(result.feedback || '').slice(0, 4000),
    improvement: String(result.improvement || '').slice(0, 4000),
    vision: metrics,
    presentation: result.presentation || {},
    aiUsed: Boolean(result.ai_used),
    evaluatedAt: new Date(),
  };

  // Atomic guard: only append if this index is still the next slot (prevents duplicate submits).
  const guard = { _id: session._id, owner: req.user.id, status: { $in: ACTIVE }, [`answers.${index}`]: { $exists: false } };
  if (index > 0) guard[`answers.${index - 1}`] = { $exists: true };
  const updated = await InterviewSession.findOneAndUpdate(
    guard,
    { $push: { answers: record }, $set: { status: 'in_progress', ...(session.startedAt ? {} : { startedAt: new Date() }) } },
    { new: true },
  );
  if (!updated) throw new ApiError(409, 'out_of_order', 'This answer was already recorded.');
  res.status(201).json({ answer: record, answeredCount: updated.answers.length, total: updated.questions.length });
}

export async function completeInterview(req, res) {
  const session = await findOwned(req, { withResumeText: true });
  if (session.status === 'completed') return res.json({ session: { ...session.toObject(), resumeText: undefined } });
  if (!ACTIVE.includes(session.status)) throw ApiError.conflict('This interview was ended and cannot be completed.');
  if (!session.answers.length) {
    throw ApiError.badRequest('No answers were recorded in this session, so there is nothing to report. Answer at least one question first.');
  }

  const history = session.answers.map((a) => ({
    round: a.round,
    question: a.question,
    answer: a.answer,
    score: a.score,
    feedback: a.feedback,
    improvement: a.improvement,
    vision: a.vision || {},
  }));
  const report = await aiClient.json('/api/interview/final', { resume_text: session.resumeText, job_description: jobContext(session), history });

  session.report = { ...report, answeredCount: session.answers.length, questionCount: session.questions.length };
  session.status = 'completed';
  session.completedAt = new Date();
  await session.save();
  const plain = session.toObject();
  delete plain.resumeText;
  res.json({ session: plain });
}

export async function abandonInterview(req, res) {
  const session = await findOwned(req);
  if (session.status === 'completed') throw ApiError.conflict('A completed interview cannot be abandoned.');
  session.status = 'abandoned';
  await session.save();
  res.json({ session });
}

export async function listInterviews(req, res) {
  const { page, limit } = req.valid.query;
  const filter = { owner: req.user.id };
  const [items, total] = await Promise.all([
    InterviewSession.find(filter)
      .select('targetRole resumeTitle status questionSource report.overall_score answers.index startedAt completedAt createdAt')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    InterviewSession.countDocuments(filter),
  ]);
  res.json({
    items: items.map(({ answers, ...rest }) => ({ ...rest, answeredCount: answers?.length || 0 })),
    page,
    limit,
    total,
    pages: Math.ceil(total / limit),
  });
}

export async function getInterview(req, res) {
  res.json({ session: await findOwned(req) });
}

export async function deleteInterview(req, res) {
  const result = await InterviewSession.deleteOne({ _id: req.valid.params.id, owner: req.user.id });
  if (!result.deletedCount) throw ApiError.notFound('Interview session not found.');
  res.status(204).end();
}
