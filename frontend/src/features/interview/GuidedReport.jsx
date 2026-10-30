import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BookOpen, Camera, Download, Info, ListChecks, Mic, Plus, RefreshCw, RotateCcw, SkipForward } from 'lucide-react';
import { api, download } from '../../lib/api.js';
import { formatDateTime } from '../../lib/format.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Alert, Badge, Button, Ring } from '../../components/ui.jsx';
import { STATUS_INFO } from './guidedModel.js';

const List = ({ title, items }) =>
  items?.length ? (
    <div>
      <b className="small">{title}</b>
      <ul>
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  ) : null;

function ReviewItem({ q, r, onRetried }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const info = STATUS_INFO[r.status];
  const e = r.evaluation;
  const retry = async () => {
    setBusy(true);
    try {
      await onRetried(r.index);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="review-item">
      <summary>
        <span className="n">Q{r.index + 1}</span>
        <span className="t">{q.question}</span>
        {e ? <span className="score-pill">{e.score}/10</span> : <Badge tone={info.tone}>{r.status === 'answered' ? 'Evaluation pending' : info.label}</Badge>}
      </summary>
      <div className="review-body">
        <p className="xsmall muted">
          {q.category} · {q.difficulty} · {info.label}
          {r.inputMethod === 'typed' ? ' · typed' : r.inputMethod === 'voice_edited' ? ' · transcript edited' : r.transcript ? ' · voice' : ''}
        </p>
        {r.transcript ? (
          <blockquote>{r.transcript}</blockquote>
        ) : (
          <p className="small muted">{r.status === 'technical_error' ? 'No answer was captured because of a technical problem.' : 'No answer text.'}</p>
        )}
        {e && (
          <div className="grid-2 review-grid">
            <List title="What you did well" items={e.strengths} />
            <List title="Missing key concepts" items={e.missing_concepts} />
            <List title="Technical inaccuracies" items={e.inaccuracies} />
            <List title="How to improve" items={e.improvements} />
          </div>
        )}
        {e?.clarity && (
          <p className="small">
            <b>Clarity and structure:</b> {e.clarity}
          </p>
        )}
        {e?.example_answer && (
          <div className="example-answer">
            <span className="ai-label">Suggested stronger answer · example, not your words</span>
            <p>{e.example_answer}</p>
          </div>
        )}
        {e?.revise?.length > 0 && (
          <div className="chip-list">
            {e.revise.map((t) => (
              <span className="chip tone-accent" key={t}>
                {t}
              </span>
            ))}
          </div>
        )}
        {e?.follow_up && (
          <p className="small">
            <b>Follow-up to practise:</b> {e.follow_up}
          </p>
        )}
        {r.status === 'answered' && !e && (
          <Alert tone="warning" action={<Button size="sm" onClick={retry} loading={busy}><RefreshCw size={14} /> Retry evaluation</Button>}>
            {r.evaluationError || 'This answer has not been evaluated yet.'} It is not included in your average until it is.
          </Alert>
        )}
        {r.status === 'skipped_for_learning' && <p className="small muted">See “Questions I need to learn” for the full explanation.</p>}
      </div>
    </details>
  );
}

function LearnItem({ q, r }) {
  const l = r.learning;
  return (
    <details className="review-item learn">
      <summary>
        <span className="n">Q{r.index + 1}</span>
        <span className="t">{q.question}</span>
        <BookOpen size={15} color="var(--ai)" aria-hidden="true" />
      </summary>
      <div className="review-body">
        {!l ? (
          <Alert tone="warning">Learning content is not ready: {r.learningError || 'not generated yet.'} Use “Generate missing answers” above.</Alert>
        ) : (
          <>
            {r.transcript && (
              <p className="small muted">
                You started with: <i>“{r.transcript}”</i>
              </p>
            )}
            <p className="small">
              <b>Why it matters:</b> {l.why_it_matters}
            </p>
            <div className="chip-list">
              {l.concepts.map((c) => (
                <span className="chip tone-ai" key={c}>
                  {c}
                </span>
              ))}
            </div>
            <div className="example-answer">
              <span className="ai-label">Suggested answer · for learning</span>
              <p>{l.example_answer}</p>
            </div>
            <p className="small">
              <b>In simpler words:</b> {l.simple_explanation}
            </p>
            {l.practical_example && (
              <p className="small">
                <b>Practical example:</b> {l.practical_example}
              </p>
            )}
            <List title="Remember" items={l.key_points} />
            <p className="small">
              <b>Practise next:</b> {l.follow_up_question}
            </p>
          </>
        )}
      </div>
    </details>
  );
}

export function GuidedReport({ session, onUpdated }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [tab, setTab] = useState('review');
  const [busy, setBusy] = useState(null);
  const r = session.report || {};
  const c = r.counts || {};
  const responses = [...(session.responses || [])].sort((a, b) => a.index - b.index);
  const skipped = responses.filter((x) => x.status === 'skipped_for_learning');
  const learningMissing = skipped.filter((x) => !x.learning).length;
  const summary = r.summary;

  const run = async (key, fn) => {
    setBusy(key);
    try {
      await fn();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  const practice = (kind) =>
    run(kind, async () => {
      const { session: next } = await api.post(`/api/interviews/${session._id}/practice`, { kind });
      navigate(`/app/interviews/${next._id}/guided`);
    });
  const regenerate = () =>
    run('learn', async () => {
      const res = await api.post(`/api/interviews/${session._id}/learning`);
      onUpdated(res.session);
      toast.success('Learning answers updated.');
    });
  const pdf = () =>
    run('pdf', async () => {
      await download(`/api/interviews/${session._id}/report.pdf`, 'RoleFit_AI_Interview_Report.pdf');
      toast.success('PDF downloaded.');
    });
  const retryEvaluation = async (index) => {
    await api.post(`/api/interviews/${session._id}/responses/${index}/evaluate`);
    // Recompute the stored report so the average includes the new score.
    const res = await api.post(`/api/interviews/${session._id}/learning`);
    onUpdated(res.session);
  };

  return (
    <div className="stack" style={{ gap: 20 }}>
      <section className="card report-hero" aria-labelledby="report-title">
        <Ring value={r.averageScore == null ? null : r.averageScore * 10} display={r.averageScore == null ? undefined : `${r.averageScore}/10`} size={112} stroke={10} label="Average score" sublabel="average" tone="ai" />
        <div className="stack" style={{ gap: 6, flex: 1, minWidth: 240 }}>
          <div className="row">
            <h1 id="report-title" style={{ fontSize: 22, letterSpacing: '-0.02em' }}>
              {session.targetRole || session.config.category}
            </h1>
            <Badge tone="tone-success">Completed</Badge>
            {session.practiceKind && <Badge tone="tone-ai">Practice</Badge>}
          </div>
          <p className="small muted">
            {session.config.category} · {session.config.difficulty} · {formatDateTime(session.completedAt)}
          </p>
          <p className="small" style={{ color: 'var(--text-2)' }}>
            {r.averageScore == null ? 'No answers were evaluated, so there is no average.' : `Average ${r.averageScore}/10 across ${c.evaluated} evaluated answer${c.evaluated === 1 ? '' : 's'}.`} AI feedback is approximate practice guidance.
          </p>
        </div>
        <div className="report-actions">
          <Button variant="primary" onClick={pdf} loading={busy === 'pdf'} disabled={learningMissing > 0} title={learningMissing ? 'Generate the missing learning answers first' : undefined}>
            <Download size={15} /> Download PDF report
          </Button>
          {skipped.length > 0 && (
            <Button onClick={() => practice('skipped')} loading={busy === 'skipped'}>
              <SkipForward size={15} /> Practice skipped questions
            </Button>
          )}
          {r.weakIndices?.length > 0 && (
            <Button onClick={() => practice('weak')} loading={busy === 'weak'}>
              <RotateCcw size={15} /> Retry weak questions
            </Button>
          )}
          <Link className="btn" to="/app/interviews">
            <Plus size={15} /> Start new interview
          </Link>
        </div>
      </section>

      {learningMissing > 0 && (
        <Alert
          tone="warning"
          title={`Learning answers for ${learningMissing} skipped question${learningMissing === 1 ? '' : 's'} are not ready`}
          action={
            <Button size="sm" variant="primary" onClick={regenerate} loading={busy === 'learn'}>
              <RefreshCw size={14} /> Generate missing answers
            </Button>
          }
        >
          The PDF is available once they are generated, so it is never incomplete.
        </Alert>
      )}

      <div className="stat-tiles">
        {[
          ['Configured', c.configured],
          ['Answered', c.answered],
          ['Skipped for learning', c.skipped],
          ['Empty answers', c.empty],
          ['Technical problems', c.technicalError],
          ...(c.notAsked ? [['Not reached', c.notAsked]] : []),
          ...(c.evaluationPending ? [['Evaluation pending', c.evaluationPending]] : []),
        ].map(([label, value]) => (
          <div className="card stat-tile" key={label}>
            <strong className="tabular">{value ?? 0}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>

      <details className="disclosure">
        <summary>
          <Info size={15} /> How the score works
        </summary>
        <div className="disclosure-body">{r.scoreMethod}</div>
      </details>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <section className="card ai-surface" aria-labelledby="summary-title">
          <div className="card-header">
            <h2 id="summary-title">Strengths and areas to improve</h2>
            <Badge tone={summary?.ai_used ? 'tone-ai' : ''}>{summary?.ai_used ? 'AI summary' : 'From per-answer feedback'}</Badge>
          </div>
          <div className="card-body stack summary-lists">
            <List title="Strengths" items={summary?.strengths} />
            <List title="Main areas to improve" items={summary?.improvements} />
            <List title="Study recommendations" items={summary?.recommendations} />
            {!summary && <p className="small muted">No summary is available for this session.</p>}
          </div>
        </section>
        <section className="card" aria-labelledby="cat-title">
          <div className="card-header">
            <h2 id="cat-title">
              <ListChecks size={16} /> By category
            </h2>
          </div>
          <table className="component-table">
            <thead>
              <tr>
                <th scope="col">Category</th>
                <th scope="col">Average</th>
                <th scope="col">Evaluated</th>
                <th scope="col">Skipped</th>
              </tr>
            </thead>
            <tbody>
              {(r.byCategory || []).map((b) => (
                <tr key={b.category}>
                  <td>{b.category}</td>
                  <td className="tabular">{b.averageScore == null ? '—' : `${b.averageScore}/10`}</td>
                  <td className="tabular">{b.evaluated}</td>
                  <td className="tabular">{b.skipped}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <div className="segmented report-tabs" role="tablist" aria-label="Report sections">
        <button type="button" role="tab" aria-selected={tab === 'review'} onClick={() => setTab('review')}>
          Question review ({responses.length})
        </button>
        <button type="button" role="tab" aria-selected={tab === 'learn'} onClick={() => setTab('learn')}>
          Questions I need to learn ({skipped.length})
        </button>
        <button type="button" role="tab" aria-selected={tab === 'coaching'} onClick={() => setTab('coaching')}>
          Speaking & visual
        </button>
      </div>

      {tab === 'review' && (
        <section className="card" role="tabpanel" aria-label="Question review">
          {responses.map((x) => (
            <ReviewItem key={x.index} q={session.questions[x.index]} r={x} onRetried={retryEvaluation} />
          ))}
          {c.notAsked > 0 && <p className="card-body small muted">{c.notAsked} question(s) were not reached because the interview ended early.</p>}
        </section>
      )}

      {tab === 'learn' && (
        <section className="card" role="tabpanel" aria-label="Questions I need to learn">
          {skipped.length ? (
            <>
              <p className="card-body small muted" style={{ paddingBottom: 0 }}>
                Suggested answers are written for learning. They are not things you said or did.
              </p>
              {skipped.map((x) => (
                <LearnItem key={x.index} q={session.questions[x.index]} r={x} />
              ))}
            </>
          ) : (
            <p className="card-body muted">You did not skip any questions in this interview.</p>
          )}
        </section>
      )}

      {tab === 'coaching' && (
        <div className="grid-2" role="tabpanel" aria-label="Speaking and visual coaching" style={{ alignItems: 'start' }}>
          <section className="card">
            <div className="card-header">
              <h2>
                <Mic size={16} /> Speaking
              </h2>
            </div>
            <div className="card-body stack small">
              <p>
                {r.speaking?.voiceAnswers || 0} voice answer(s), {r.speaking?.typedAnswers || 0} typed, {r.speaking?.editedTranscripts || 0} transcript(s) corrected by hand.
              </p>
              {r.speaking?.answersWithRecognitionRestarts > 0 && <p>Recognition reconnected during {r.speaking.answersWithRecognitionRestarts} answer(s). Check those transcripts for gaps.</p>}
              {r.speaking?.recognitionErrors?.length > 0 && <p>Recognition reported: {r.speaking.recognitionErrors.join(', ')}.</p>}
              <p className="xsmall muted">Speaking speed and filler words were not measured, so no metrics are shown for them.</p>
            </div>
          </section>
          <section className="card">
            <div className="card-header">
              <h2>
                <Camera size={16} /> Visual presentation
              </h2>
              <span className="xsmall muted">On-device · approximate</span>
            </div>
            <div className="card-body stack small">
              {!r.visual?.enabled ? (
                <p className="muted">Visual coaching was not enabled for this interview.</p>
              ) : !r.visual.measuredQuestions ? (
                <p className="muted">Enabled, but no reliable camera measurements were captured.</p>
              ) : (
                <>
                  <p>
                    Face fully in frame: <b>{r.visual.faceInFramePct == null ? 'unavailable (no face detected)' : `${r.visual.faceInFramePct}% of samples`}</b>. Facing the camera:{' '}
                    <b>{r.visual.facingCameraPct == null ? 'unavailable' : `${r.visual.facingCameraPct}% of samples where your face was visible`}</b>.
                  </p>
                  <ul>
                    {r.visual.perQuestion.map((p) => (
                      <li key={p.index}>
                        Q{p.index + 1}:{' '}
                        {p.faceInFramePct == null ? 'no face detected — not measured' : `in frame ${p.faceInFramePct}% · facing ${p.facingCameraPct ?? '—'}% · looked away ${p.lookAwayEvents ?? 0}×`}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <p className="xsmall muted">These cues describe framing and head orientation only. They do not measure emotion, confidence, honesty or suitability for a job.</p>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
