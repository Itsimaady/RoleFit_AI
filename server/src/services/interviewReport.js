// Deterministic aggregation for guided interviews. Pure functions: easy to test
// and identical for the dashboard, the report page and the PDF.

export const WEAK_SCORE_THRESHOLD = 6; // scores below this (out of 10) count as "weak"

export const SCORE_METHOD =
  'Each answered question is scored 0–10 by Gemini against criteria for its category and difficulty. ' +
  'The average includes only answers that were evaluated. Questions you skipped for learning, empty answers, ' +
  'answers whose evaluation failed and technical problems are listed separately and are never counted as zero.';

const round1 = (n) => Math.round(n * 10) / 10;
const mean = (values) => (values.length ? round1(values.reduce((a, b) => a + b, 0) / values.length) : null);

export function isEvaluated(response) {
  return response?.status === 'answered' && Number.isFinite(response?.evaluation?.score);
}

export function computeGuidedReport(session) {
  const responses = session.responses || [];
  const questions = session.questions || [];
  const evaluated = responses.filter(isEvaluated);
  const counts = {
    configured: questions.length,
    asked: responses.length,
    notAsked: Math.max(0, questions.length - responses.length),
    answered: responses.filter((r) => r.status === 'answered').length,
    evaluated: evaluated.length,
    evaluationPending: responses.filter((r) => r.status === 'answered' && !isEvaluated(r)).length,
    skipped: responses.filter((r) => r.status === 'skipped_for_learning').length,
    empty: responses.filter((r) => r.status === 'answered_but_empty').length,
    technicalError: responses.filter((r) => r.status === 'technical_error').length,
  };

  const categoryOf = (r) => questions[r.index]?.category || session.config?.category || 'General';
  const byCategoryMap = new Map();
  for (const r of responses) {
    const key = categoryOf(r);
    const entry = byCategoryMap.get(key) || { category: key, asked: 0, skipped: 0, scores: [] };
    entry.asked += 1;
    if (r.status === 'skipped_for_learning') entry.skipped += 1;
    if (isEvaluated(r)) entry.scores.push(r.evaluation.score);
    byCategoryMap.set(key, entry);
  }
  const byCategory = [...byCategoryMap.values()].map(({ scores, ...rest }) => ({ ...rest, evaluated: scores.length, averageScore: mean(scores) }));

  const weakIndices = evaluated.filter((r) => r.evaluation.score < WEAK_SCORE_THRESHOLD).map((r) => r.index);
  const skippedIndices = responses.filter((r) => r.status === 'skipped_for_learning').map((r) => r.index);

  // Recognition health actually measured in the browser.
  const voice = responses.filter((r) => r.status === 'answered' && r.inputMethod !== 'typed' && r.transcript);
  const speaking = {
    voiceAnswers: voice.length,
    typedAnswers: responses.filter((r) => r.status === 'answered' && r.inputMethod === 'typed').length,
    editedTranscripts: responses.filter((r) => r.status === 'answered' && r.inputMethod === 'voice_edited').length,
    answersWithRecognitionRestarts: responses.filter((r) => (r.recognition?.restarts || 0) > 0).length,
    recognitionErrors: [...new Set(responses.flatMap((r) => r.recognition?.errors || []))],
  };

  // Visual coaching: only questions with real samples count.
  const visualMeasured = responses.filter((r) => (r.visual?.samples || 0) > 0);
  const visual = session.config?.visualCoaching
    ? {
        enabled: true,
        measuredQuestions: visualMeasured.length,
        faceInFramePct: mean(visualMeasured.map((r) => r.visual.faceInFramePct).filter(Number.isFinite)),
        facingCameraPct: mean(visualMeasured.map((r) => r.visual.facingCameraPct).filter(Number.isFinite)),
        perQuestion: visualMeasured.map((r) => ({ index: r.index, ...r.visual })),
      }
    : { enabled: false };

  return {
    counts,
    averageScore: mean(evaluated.map((r) => r.evaluation.score)),
    scoreOutOf: 10,
    scoreMethod: SCORE_METHOD,
    byCategory,
    weakIndices,
    skippedIndices,
    speaking,
    visual,
  };
}
