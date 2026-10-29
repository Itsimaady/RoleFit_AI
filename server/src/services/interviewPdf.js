// Interview learning report as a real PDF (PDFKit). Uses an embedded DejaVu
// Sans font so non-ASCII text (₹, “quotes”, —, accents) renders correctly;
// characters the font cannot draw are replaced instead of producing tofu.
import { createRequire } from 'node:module';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import * as fontkit from 'fontkit';
import { computeGuidedReport, isEvaluated } from './interviewReport.js';

const require = createRequire(import.meta.url);
const FONT_DIR = path.join(path.dirname(require.resolve('dejavu-fonts-ttf/package.json')), 'ttf');
const FONTS = {
  regular: path.join(FONT_DIR, 'DejaVuSans.ttf'),
  bold: path.join(FONT_DIR, 'DejaVuSans-Bold.ttf'),
  italic: path.join(FONT_DIR, 'DejaVuSans-Oblique.ttf'),
};
const glyphs = fontkit.openSync(FONTS.regular);

const INDIGO = '#4f46e5';
const VIOLET = '#7c3aed';
const TEXT = '#16161d';
const MUTED = '#5b5e70';
const RULE = '#e2e4ec';
// Ligatures (fi, fl) break copy/paste and text search in many PDF readers.
const NO_LIGATURES = [];
const STATUS_LABEL = {
  answered: 'Answered',
  skipped_for_learning: 'Skipped for learning',
  answered_but_empty: 'Empty answer',
  technical_error: 'Technical problem',
};

export function cleanText(value) {
  return Array.from(String(value ?? ''))
    .map((ch) => {
      const cp = ch.codePointAt(0);
      if (cp === 10) return '\n';
      if (cp < 32 || (cp >= 127 && cp < 160)) return ' ';
      return glyphs.hasGlyphForCodePoint(cp) ? ch : '?';
    })
    .join('')
    .trim();
}

export function renderInterviewReportPdf(session) {
  const report = { ...computeGuidedReport(session), summary: session.report?.summary || null };
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 56, bottom: 64, left: 56, right: 56 },
    bufferPages: true,
    info: { Title: 'RoleFit AI Interview Report', Author: 'RoleFit AI', Subject: cleanText(session.targetRole || session.config?.category || 'Mock interview') },
  });
  doc.registerFont('regular', FONTS.regular);
  doc.registerFont('bold', FONTS.bold);
  doc.registerFont('italic', FONTS.italic);

  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const bottomLimit = () => doc.page.height - doc.page.margins.bottom;
  const ensure = (needed) => {
    if (doc.y + needed > bottomLimit()) doc.addPage();
  };

  const para = (text, { font = 'regular', size = 10, color = TEXT, indent = 0, gap = 4 } = {}) => {
    const t = cleanText(text);
    if (!t) return;
    doc.font(font).fontSize(size).fillColor(color).text(t, left + indent, doc.y, { features: NO_LIGATURES, width: width - indent, lineGap: 1.5 });
    doc.moveDown(gap / 10);
  };
  const h1 = (text) => {
    ensure(60);
    doc.moveDown(0.6);
    doc.font('bold').fontSize(15).fillColor(INDIGO).text(cleanText(text), left, doc.y, { features: NO_LIGATURES, width });
    const y = doc.y + 3;
    doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.8).strokeColor(RULE).stroke();
    doc.y = y + 8;
  };
  const h2 = (text, color = TEXT) => {
    ensure(40);
    doc.moveDown(0.3);
    doc.font('bold').fontSize(11.5).fillColor(color).text(cleanText(text), left, doc.y, { features: NO_LIGATURES, width });
    doc.moveDown(0.2);
  };
  const label = (text) => {
    ensure(28);
    doc.font('bold').fontSize(9).fillColor(MUTED).text(cleanText(text).toUpperCase(), left, doc.y, { features: NO_LIGATURES, width, characterSpacing: 0.4 });
    doc.moveDown(0.15);
  };
  const bullets = (items, indent = 10) => {
    for (const item of (items || []).map(cleanText).filter(Boolean)) {
      ensure(20);
      doc.font('regular').fontSize(10).fillColor(TEXT).text(`•  ${item}`, left + indent, doc.y, { features: NO_LIGATURES, width: width - indent, indent: -9, lineGap: 1.5 });
      doc.moveDown(0.15);
    }
  };
  const keyValues = (rows) => {
    for (const [k, v] of rows) {
      if (v === undefined || v === null || v === '') continue;
      ensure(18);
      const y = doc.y;
      doc.font('bold').fontSize(10).fillColor(MUTED).text(cleanText(k), left, y, { features: NO_LIGATURES, width: 150 });
      const leftEnd = doc.y;
      doc.font('regular').fontSize(10).fillColor(TEXT).text(cleanText(v), left + 160, y, { features: NO_LIGATURES, width: width - 160 });
      doc.y = Math.max(leftEnd, doc.y) + 3;
    }
  };

  // ---- Title
  doc.font('bold').fontSize(22).fillColor(TEXT).text('RoleFit ', left, doc.y, { continued: true }).fillColor(VIOLET).text('AI');
  doc.font('regular').fontSize(12).fillColor(MUTED).text('Mock interview learning report');
  doc.moveDown(0.3);
  doc.fontSize(9).text(`Generated ${new Date().toUTCString()}`);

  // ---- 1. Configuration
  const c = session.config || {};
  h1('Interview configuration');
  keyValues([
    ['Category', c.category],
    ['Difficulty', c.difficulty],
    ['Questions configured', String(report.counts.configured)],
    ['Target role', session.targetRole],
    ['Company', c.company],
    ['Programming language', c.language],
    ['Resume used', session.resumeTitle || 'None (general questions)'],
    ['Job description', session.jobDescription ? 'Provided' : 'Not provided'],
    ['Practice session', session.practiceKind ? (session.practiceKind === 'skipped' ? 'Practising skipped questions' : 'Retrying weak answers') : null],
  ]);

  // ---- 2. Overall performance
  h1('Overall performance');
  const k = report.counts;
  keyValues([
    ['Average score', report.averageScore == null ? 'No evaluated answers' : `${report.averageScore} / 10 across ${k.evaluated} evaluated answer${k.evaluated === 1 ? '' : 's'}`],
    ['Answered', String(k.answered)],
    ['Skipped for learning', String(k.skipped)],
    ['Empty answers', String(k.empty)],
    ['Technical problems', String(k.technicalError)],
    ['Evaluation pending', k.evaluationPending ? String(k.evaluationPending) : null],
    ['Not reached', k.notAsked ? `${k.notAsked} (interview ended early)` : null],
  ]);
  para(report.scoreMethod, { size: 8.5, color: MUTED, gap: 6 });
  if (report.byCategory.length > 1) {
    label('By category');
    keyValues(report.byCategory.map((b) => [b.category, `${b.averageScore == null ? '—' : `${b.averageScore}/10`} · ${b.evaluated} evaluated · ${b.skipped} skipped`]));
  }
  const s = report.summary;
  if (s) {
    if (s.strengths?.length) {
      h2('Strengths');
      bullets(s.strengths);
    }
    if (s.improvements?.length) {
      h2('Main areas to improve');
      bullets(s.improvements);
    }
    if (s.recommendations?.length) {
      h2('Study recommendations');
      bullets(s.recommendations);
    }
    para(s.ai_used ? 'Summary written by Gemini from the per-question feedback. AI feedback is approximate.' : 'Summary compiled from the per-question feedback (AI summary unavailable).', { size: 8.5, color: MUTED });
  }

  // ---- 3. Question-by-question
  const responses = [...(session.responses || [])].sort((a, b) => a.index - b.index);
  h1('Question-by-question review');
  if (!responses.length) para('No questions were answered.', { color: MUTED });
  for (const r of responses) {
    const q = session.questions[r.index] || {};
    ensure(90);
    h2(`Q${r.index + 1}. ${q.question || ''}`);
    para(`${q.category || c.category || ''} · ${q.difficulty || c.difficulty || ''} · ${STATUS_LABEL[r.status] || r.status}${isEvaluated(r) ? ` · Score ${r.evaluation.score}/10` : ''}`, { size: 9, color: MUTED });
    if (r.transcript) {
      label(r.status === 'skipped_for_learning' ? 'Partial answer before skipping' : r.inputMethod === 'typed' ? 'Your typed answer' : 'Your answer (speech transcript)');
      para(r.transcript, { font: 'italic', size: 9.5, color: '#33354a', indent: 8 });
    }
    if (isEvaluated(r)) {
      const e = r.evaluation;
      if (e.strengths?.length) {
        label('What you did well');
        bullets(e.strengths);
      }
      if (e.missing_concepts?.length) {
        label('Missing key concepts');
        bullets(e.missing_concepts);
      }
      if (e.inaccuracies?.length) {
        label('Technical inaccuracies');
        bullets(e.inaccuracies);
      }
      if (e.clarity) {
        label('Clarity and structure');
        para(e.clarity);
      }
      if (e.improvements?.length) {
        label('How to improve');
        bullets(e.improvements);
      }
      label('Suggested stronger answer (example, not your words)');
      para(e.example_answer, { indent: 8 });
      if (e.follow_up) {
        label('Follow-up question to practise');
        para(e.follow_up);
      }
    } else if (r.status === 'answered') {
      para(`Evaluation pending: ${r.evaluationError || 'not evaluated yet.'}`, { color: '#b45309', size: 9.5 });
    } else if (r.status === 'skipped_for_learning') {
      para('See “Questions I need to learn” for a full explanation.', { color: MUTED, size: 9.5 });
    }
    doc.moveDown(0.4);
  }

  // ---- 4. Learning section
  const skipped = responses.filter((r) => r.status === 'skipped_for_learning');
  if (skipped.length) {
    h1('Questions I need to learn');
    para('Example answers below are suggested responses for study. They are not things you said or did.', { size: 9, color: MUTED });
    for (const r of skipped) {
      const q = session.questions[r.index] || {};
      const l = r.learning;
      ensure(100);
      h2(`Q${r.index + 1}. ${q.question || ''}`, VIOLET);
      if (!l) {
        para(`Learning content unavailable: ${r.learningError || 'not generated.'}`, { color: '#b45309' });
        continue;
      }
      label('Why it matters');
      para(l.why_it_matters);
      label('Concepts you need');
      bullets(l.concepts);
      label('Suggested answer');
      para(l.example_answer, { indent: 8 });
      label('In simpler words');
      para(l.simple_explanation);
      if (l.practical_example) {
        label('Practical example');
        para(l.practical_example);
      }
      label('Remember');
      bullets(l.key_points);
      label('Practice question');
      para(l.follow_up_question);
      doc.moveDown(0.4);
    }
  }

  // ---- 5. Topics to revise
  const topics = [...new Set(responses.flatMap((r) => [...(r.evaluation?.revise || []), ...(r.learning?.concepts || [])]).map(cleanText).filter(Boolean))];
  if (topics.length) {
    h1('Key topics to revise');
    bullets(topics.slice(0, 30));
  }

  // ---- 6. Speaking and visual coaching (measured data only)
  h1('Speaking and visual coaching');
  const sp = report.speaking;
  keyValues([
    ['Voice answers', String(sp.voiceAnswers)],
    ['Typed answers', String(sp.typedAnswers)],
    ['Transcripts corrected by hand', String(sp.editedTranscripts)],
    ['Answers where recognition restarted', String(sp.answersWithRecognitionRestarts)],
    ['Recognition errors seen', sp.recognitionErrors.length ? sp.recognitionErrors.join(', ') : 'None'],
  ]);
  para('Speech recognition quality depends on the browser, microphone, accent and background noise. Speaking speed and filler words were not measured.', { size: 8.5, color: MUTED, gap: 6 });
  const v = report.visual;
  if (v.enabled) {
    label('Visual presentation coaching (on-device, approximate)');
    if (!v.measuredQuestions) para('Enabled, but no reliable camera measurements were captured.', { color: MUTED });
    else {
      keyValues([
        ['Face within frame', v.faceInFramePct == null ? 'Unavailable (no face detected)' : `${v.faceInFramePct}% of samples`],
        ['Facing the camera', v.facingCameraPct == null ? 'Unavailable' : `${v.facingCameraPct}% of samples (when the face was visible)`],
      ]);
      for (const pq of v.perQuestion) {
        para(
          pq.faceInFramePct == null
            ? `Q${pq.index + 1}: no face detected — not measured`
            : `Q${pq.index + 1}: face in frame ${pq.faceInFramePct}% · facing camera ${pq.facingCameraPct ?? '—'}% · looked away ${pq.lookAwayEvents ?? 0} time(s)`,
          { size: 9, color: MUTED, gap: 1 },
        );
      }
    }
    para('These are observable framing and head-orientation cues only. They do not measure emotion, confidence, honesty or suitability for a job.', { size: 8.5, color: MUTED });
  } else {
    para('Visual presentation coaching was not enabled for this interview.', { color: MUTED });
  }

  // ---- 7. Next steps
  h1('Recommended next steps');
  const next = [];
  if (k.skipped) next.push(`Study the ${k.skipped} skipped question${k.skipped === 1 ? '' : 's'} above, then use “Practice Skipped Questions” in RoleFit AI.`);
  if (report.weakIndices.length) next.push(`Retry the ${report.weakIndices.length} answer${report.weakIndices.length === 1 ? '' : 's'} scored below 6/10 with “Retry Weak Questions”.`);
  if (topics.length) next.push(`Revise: ${topics.slice(0, 5).join(', ')}.`);
  next.push('Run another interview at the same difficulty, then move up a level once your average is consistently above 7/10.');
  bullets(next);

  // ---- Footer with page numbers
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('regular').fontSize(8).fillColor(MUTED).text(`RoleFit AI · Interview report · Page ${i + 1} of ${range.count}`, left, doc.page.height - 36, { features: NO_LIGATURES, width, align: 'center', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
  doc.end();
  return done;
}
