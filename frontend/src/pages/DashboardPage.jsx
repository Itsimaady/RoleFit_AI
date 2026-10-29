import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, FileText, MessageSquare, Plus, Target } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useApiData } from '../hooks/useApiData.js';
import { Badge, EmptyState, ErrorState, Meter, PageHeader, Skeleton, SkeletonList } from '../components/ui.jsx';
import { STATUS_LABEL, STATUS_TONE, formatDate, timeAgo } from '../lib/format.js';

function Stat({ icon: Icon, value, label }) {
  return (
    <div className="card stat">
      <span className="stat-icon" aria-hidden="true">
        <Icon size={20} />
      </span>
      <div>
        <strong>{value}</strong>
        <span>{label}</span>
      </div>
    </div>
  );
}

function GettingStarted({ counts }) {
  const steps = [
    { done: counts.resumes > 0, label: 'Create your first resume', to: '/app/resumes' },
    { done: counts.analyses > 0, label: 'Compare it with a job description', to: '/app/analyses' },
    { done: counts.interviews > 0, label: 'Practise a mock interview', to: '/app/interviews' },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null;
  return (
    <section className="card" aria-labelledby="getting-started">
      <div className="card-header">
        <h2 id="getting-started">Getting started</h2>
        <span className="small muted">
          {doneCount} of {steps.length} done
        </span>
      </div>
      <div className="card-body">
        <ol className="steps">
          {steps.map((s, i) => (
            <li key={s.label} className={s.done ? 'done' : ''}>
              <span className="step-dot">{s.done ? <CheckCircle2 size={15} /> : i + 1}</span>
              <span className="step-text" style={{ flex: 1 }}>
                {s.label}
              </span>
              {!s.done && (
                <Link className="btn btn-sm" to={s.to}>
                  Start <ArrowRight size={14} />
                </Link>
              )}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function DashboardPage() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useApiData('/api/dashboard');
  const firstName = user.fullName.split(' ')[0];

  return (
    <div className="page">
      <PageHeader title={`Welcome, ${firstName}`} description="Pick up where you left off, or start a new step." />

      {error && (
        <div className="card">
          <ErrorState error={error} onRetry={reload} />
        </div>
      )}

      {!error && (
        <>
          <div className="stats">
            {loading || !data ? (
              Array.from({ length: 4 }, (_, i) => (
                <div className="card stat" key={i}>
                  <Skeleton height={42} width={42} />
                  <div className="stack" style={{ gap: 6, flex: 1 }}>
                    <Skeleton width="40%" height={20} />
                    <Skeleton width="70%" height={12} />
                  </div>
                </div>
              ))
            ) : (
              <>
                <Stat icon={FileText} value={data.counts.resumes} label="Resumes" />
                <Stat icon={Target} value={data.counts.analyses} label="Job analyses" />
                <Stat icon={MessageSquare} value={data.counts.interviews} label="Interview sessions" />
                <Stat icon={CheckCircle2} value={data.counts.completedInterviews} label="Completed interviews" />
              </>
            )}
          </div>

          {data && <GettingStarted counts={data.counts} />}

          <section aria-labelledby="quick-actions">
            <h2 id="quick-actions" className="sr-only">
              Quick actions
            </h2>
            <div className="actions-grid">
              <Link className="action-card" to="/app/resumes?new=1">
                <span className="stat-icon">
                  <Plus size={20} />
                </span>
                <b>Create a resume</b>
                <span>Start from a blank, guided template.</span>
              </Link>
              <Link className="action-card" to="/app/analyses">
                <span className="stat-icon">
                  <Target size={20} />
                </span>
                <b>Analyze a job description</b>
                <span>See matched skills, gaps and next steps.</span>
              </Link>
              <Link className="action-card" to="/app/interviews">
                <span className="stat-icon">
                  <MessageSquare size={20} />
                </span>
                <b>Start a mock interview</b>
                <span>Practise 12 questions for your target role.</span>
              </Link>
            </div>
          </section>

          <div className="grid-2">
            <section className="card" aria-labelledby="recent-resumes">
              <div className="card-header">
                <h2 id="recent-resumes">Recent resumes</h2>
                <Link to="/app/resumes" className="small">
                  View all
                </Link>
              </div>
              {loading && !data ? (
                <SkeletonList />
              ) : data?.recentResumes.length ? (
                <ul className="list">
                  {data.recentResumes.map((r) => (
                    <li className="list-row" key={r._id}>
                      <FileText size={18} className="muted" aria-hidden="true" />
                      <div className="grow">
                        <Link className="title" to={`/app/resumes/${r._id}`}>
                          {r.title}
                        </Link>
                        <span className="meta">Updated {timeAgo(r.updatedAt)}</span>
                      </div>
                      <Badge>{r.template}</Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState icon={FileText} title="No resumes yet" action={<Link className="btn btn-primary btn-sm" to="/app/resumes?new=1">Create resume</Link>}>
                  Your saved resumes will appear here.
                </EmptyState>
              )}
            </section>

            <section className="card" aria-labelledby="recent-analyses">
              <div className="card-header">
                <h2 id="recent-analyses">Recent job analyses</h2>
                <Link to="/app/analyses" className="small">
                  View all
                </Link>
              </div>
              {loading && !data ? (
                <SkeletonList />
              ) : data?.recentAnalyses.length ? (
                <ul className="list">
                  {data.recentAnalyses.map((a) => (
                    <li className="list-row" key={a._id}>
                      <div className="grow">
                        <Link className="title" to={`/app/analyses/${a._id}`}>
                          {a.targetRole || 'Untitled role'}
                        </Link>
                        <span className="meta">
                          {a.resumeSnapshot?.title} · {formatDate(a.createdAt)}
                        </span>
                      </div>
                      <div style={{ width: 90 }} className="stack">
                        <span className="small" style={{ textAlign: 'right' }}>
                          {a.scores?.skillCoverage ?? '—'}
                          {a.scores?.skillCoverage != null && '%'} skills
                        </span>
                        {a.scores?.skillCoverage != null && <Meter value={a.scores.skillCoverage} label="Skill coverage" />}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState icon={Target} title="No analyses yet" action={<Link className="btn btn-primary btn-sm" to="/app/analyses">Analyze a job</Link>}>
                  Compare a resume with a job description to see your skill gaps.
                </EmptyState>
              )}
            </section>

            <section className="card" aria-labelledby="recent-interviews">
              <div className="card-header">
                <h2 id="recent-interviews">Recent interviews</h2>
                <Link to="/app/interviews" className="small">
                  View all
                </Link>
              </div>
              {loading && !data ? (
                <SkeletonList />
              ) : data?.recentInterviews.length ? (
                <ul className="list">
                  {data.recentInterviews.map((i) => (
                    <li className="list-row" key={i._id}>
                      <div className="grow">
                        <Link className="title" to={`/app/interviews/${i._id}`}>
                          {i.targetRole}
                        </Link>
                        <span className="meta">
                          {i.answeredCount}/12 answered · {formatDate(i.createdAt)}
                        </span>
                      </div>
                      {i.status === 'completed' && i.report?.overall_score != null ? (
                        <Badge tone="tone-success">{i.report.overall_score}/100</Badge>
                      ) : (
                        <Badge tone={STATUS_TONE[i.status]}>{STATUS_LABEL[i.status]}</Badge>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState icon={MessageSquare} title="No interviews yet" action={<Link className="btn btn-primary btn-sm" to="/app/interviews">Set up an interview</Link>}>
                  Practise with an AI interviewer and review feedback on every answer.
                </EmptyState>
              )}
            </section>

            <section className="card" aria-labelledby="progress">
              <div className="card-header">
                <h2 id="progress">Interview progress</h2>
              </div>
              <div className="card-body">
                {loading && !data ? (
                  <SkeletonList rows={2} />
                ) : data?.interviewScores.length ? (
                  <div className="score-bars">
                    <p className="small muted" style={{ marginBottom: 6 }}>
                      Overall scores from your completed interviews, oldest first. Scores are AI-assisted estimates.
                    </p>
                    {data.interviewScores.map((s) => (
                      <div className="score-bar" key={s.id}>
                        <span className="small muted" title={s.targetRole}>
                          {formatDate(s.completedAt)}
                        </span>
                        <Meter value={s.score ?? 0} tone="success" label={`Score for ${s.targetRole}`} />
                        <b className="small">{s.score ?? '—'}</b>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="muted">Complete a mock interview to start tracking your progress here.</p>
                )}
                {data?.activity?.length > 0 && (
                  <>
                    <h3 style={{ fontSize: 14, margin: '20px 0 10px' }}>Recent activity</h3>
                    <ul className="list stack" style={{ gap: 8 }}>
                      {data.activity.map((a) => (
                        <li key={`${a.type}-${a.id}-${a.at}`} className="small row" style={{ justifyContent: 'space-between' }}>
                          <span>{a.label}</span>
                          <span className="muted">{timeAgo(a.at)}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
