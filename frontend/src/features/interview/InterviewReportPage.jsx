import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Info, MessageSquare, Trash2 } from 'lucide-react';
import { api } from '../../lib/api.js';
import { STATUS_LABEL, formatDateTime } from '../../lib/format.js';
import { useApiData } from '../../hooks/useApiData.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Alert, Badge, Button, ConfirmDialog, ErrorState, Meter, PageLoader, Ring } from '../../components/ui.jsx';
import { GuidedReport } from './GuidedReport.jsx';

const COMPONENT_LABEL = {
  answer_technical_quality: 'Answer / technical quality',
  communication: 'Delivery (transcript length & filler words)',
  facial_expression: 'Facial engagement',
  body_language: 'Posture',
  response_delivery: 'Steadiness',
};

export function InterviewReportPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { data, error, loading, reload, setData } = useApiData(`/api/interviews/${id}`);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const remove = async () => {
    setDeleting(true);
    try {
      await api.del(`/api/interviews/${id}`);
      toast.success('Interview deleted.');
      navigate('/app/interviews', { replace: true });
    } catch (err) {
      toast.error(err.message);
      setDeleting(false);
    }
  };

  if (loading && !data) return <PageLoader label="Loading report" />;
  if (error)
    return (
      <div className="page">
        <div className="card">
          <ErrorState error={error} onRetry={reload} />
        </div>
      </div>
    );

  const s = data.session;
  if (s.mode === 'guided') {
    if (s.status === 'ready' || s.status === 'in_progress') return <Navigate to={`/app/interviews/${id}/guided`} replace />;
    return (
      <div className="page page-wide">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <Link to="/app/interviews" className="back-link">
            <ArrowLeft size={14} /> Mock interviews
          </Link>
          <Button size="sm" onClick={() => setConfirmDelete(true)}>
            <Trash2 size={14} /> Delete
          </Button>
        </div>
        {s.status === 'abandoned' ? (
          <Alert tone="info" title="This interview was ended before any question was answered">
            There is nothing to report. <Link to="/app/interviews">Start a new interview</Link>.
          </Alert>
        ) : (
          <GuidedReport session={s} onUpdated={(session) => setData({ session })} />
        )}
        <ConfirmDialog open={confirmDelete} title="Delete this interview?" confirmLabel="Delete" tone="danger" loading={deleting} onConfirm={remove} onCancel={() => setConfirmDelete(false)}>
          <p>The transcripts, scores and learning answers will be permanently deleted.</p>
        </ConfirmDialog>
      </div>
    );
  }
  const r = s.report;
  const components = r?.components ? Object.entries(r.components) : [];
  const anyFallback = s.answers.some((a) => !a.aiUsed) || (r && !r.ai_used);

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <Link to="/app/interviews" className="back-link">
          <ArrowLeft size={14} /> Mock interviews
        </Link>
        <div className="row">
          {(s.status === 'ready' || s.status === 'in_progress') && (
            <Link className="btn btn-primary btn-sm" to={`/app/interviews/${id}/live`}>
              <MessageSquare size={14} /> Continue interview
            </Link>
          )}
          <Button size="sm" onClick={() => setConfirmDelete(true)}>
            <Trash2 size={14} /> Delete
          </Button>
        </div>
      </div>

      <section className="card report-hero" aria-labelledby="report-title">
        <Ring value={r?.overall_score} size={112} stroke={10} label="Overall score" sublabel="/ 100" tone="ai" />
        <div className="stack" style={{ gap: 6, flex: 1, minWidth: 240 }}>
          <div className="row">
            <h1 id="report-title" style={{ fontSize: 22, letterSpacing: '-0.02em' }}>
              {s.targetRole}
            </h1>
            <Badge tone={s.status === 'completed' ? 'tone-success' : 'tone-warning'}>{STATUS_LABEL[s.status]}</Badge>
          </div>
          <p className="small muted">
            {s.resumeTitle} · {s.answers.length} of {s.questions.length} questions answered · {formatDateTime(s.completedAt || s.updatedAt)}
          </p>
          <p className="small" style={{ color: 'var(--text-2)' }}>
            Approximate, AI-assisted practice feedback. It is not a prediction of interview outcomes.
          </p>
        </div>
      </section>

      {!r && <Alert tone="info" title="No report yet">This interview has not been completed. Continue it, or end it from the interview screen to generate a report from the answers recorded so far.</Alert>}
      {anyFallback && r && (
        <Alert tone="warning" title="Some feedback was estimated without AI">
          Gemini was unavailable for part of this session, so some scores and feedback use a simple rule-based estimate (marked below).
        </Alert>
      )}

      {r && (
        <div className="grid-2" style={{ alignItems: 'start' }}>
          <section className="card" aria-labelledby="breakdown">
            <div className="card-header">
              <h2 id="breakdown">Score breakdown</h2>
            </div>
            <table className="component-table">
              <thead>
                <tr>
                  <th scope="col">Component</th>
                  <th scope="col">Score</th>
                  <th scope="col">Weight</th>
                </tr>
              </thead>
              <tbody>
                {components.map(([key, c]) => (
                  <tr key={key}>
                    <td>{COMPONENT_LABEL[key] || key}</td>
                    <td style={{ minWidth: 120 }}>
                      {c.score == null ? (
                        <span className="muted small">Not measured</span>
                      ) : (
                        <div className="row" style={{ flexWrap: 'nowrap' }}>
                          <b style={{ width: 28 }}>{c.score}</b>
                          <div style={{ flex: 1 }}>
                            <Meter value={c.score} label={COMPONENT_LABEL[key]} />
                          </div>
                        </div>
                      )}
                    </td>
                    <td>{c.weight}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="card-body">
              <p className="small muted">
                <Info size={13} style={{ verticalAlign: '-2px' }} /> {r.weighting_note} Presentation signals come from your browser’s camera analysis and are rough estimates.
              </p>
            </div>
          </section>

          <section className="card ai-surface" aria-labelledby="summary">
            <div className="card-header">
              <h2 id="summary">Feedback summary</h2>
              <Badge tone={r.ai_used ? 'tone-accent' : ''}>{r.ai_used ? 'AI-generated' : 'Rule-based'}</Badge>
            </div>
            <div className="card-body stack">
              {r.summary && <p>{r.summary}</p>}
              {r.strengths?.length > 0 && (
                <div>
                  <h3 style={{ fontSize: 14, marginBottom: 6 }}>Strengths</h3>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {r.strengths.map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                </div>
              )}
              {r.improvements?.length > 0 && (
                <div>
                  <h3 style={{ fontSize: 14, marginBottom: 6 }}>What to improve</h3>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {r.improvements.map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ul>
                </div>
              )}
              {r.topics?.length > 0 && (
                <div>
                  <h3 style={{ fontSize: 14, marginBottom: 6 }}>Topics to review</h3>
                  <div className="chip-list">
                    {r.topics.map((t) => (
                      <span className="chip tone-accent" key={t}>
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      <section className="card" aria-labelledby="answers">
        <div className="card-header">
          <h2 id="answers">Question-by-question review</h2>
        </div>
        {s.answers.length === 0 ? (
          <div className="card-body muted">No answers were recorded.</div>
        ) : (
          s.answers.map((a) => (
            <article className="qa" key={a.index}>
              <div className="qa-head">
                <span className="small muted">
                  Q{a.index + 1} · {a.round}
                </span>
                <div className="row">
                  {!a.aiUsed && <Badge>Estimated</Badge>}
                  <span className="qa-score">{a.score}/100</span>
                </div>
              </div>
              <b>{a.question}</b>
              <blockquote aria-label="Your answer transcript">{a.answer}</blockquote>
              {a.feedback && (
                <p className="small">
                  <b>Feedback:</b> {a.feedback}
                </p>
              )}
              {a.improvement && (
                <p className="small">
                  <b>Try next time:</b> {a.improvement}
                </p>
              )}
            </article>
          ))
        )}
        {s.questions.length > s.answers.length && s.status !== 'ready' && (
          <div className="card-body small muted" style={{ borderTop: '1px solid var(--border)' }}>
            {s.questions.length - s.answers.length} question(s) were not answered.
          </div>
        )}
      </section>

      <ConfirmDialog open={confirmDelete} title="Delete this interview?" confirmLabel="Delete" tone="danger" loading={deleting} onConfirm={remove} onCancel={() => setConfirmDelete(false)}>
        <p>The transcript, scores and feedback will be permanently deleted.</p>
      </ConfirmDialog>
    </div>
  );
}
