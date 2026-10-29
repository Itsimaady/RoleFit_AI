import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, FileText, MessageSquare, Plus, Target } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useApiData } from '../hooks/useApiData.js';
import { Badge, EmptyState, ErrorState, Meter, Skeleton, SkeletonList } from '../components/ui.jsx';
import { STATUS_LABEL, STATUS_TONE, formatDate, timeAgo } from '../lib/format.js';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/** Picks the most useful next action from the user's real records. */
function nextAction(data) {
  const unfinished = data.recentInterviews.find((i) => i.status === 'ready' || i.status === 'in_progress');
  if (unfinished) {
    return {
      kicker: 'Continue where you left off',
      icon: MessageSquare,
      title: `${unfinished.targetRole} mock interview`,
      meta: `${unfinished.answeredCount} of 12 questions answered · started ${timeAgo(unfinished.createdAt)}`,
      to: `/app/interviews/${unfinished._id}/live`,
      cta: unfinished.answeredCount ? 'Resume interview' : 'Start interview',
    };
  }
  const resume = data.recentResumes[0];
  if (resume) {
    const analysed = data.recentAnalyses.some((a) => a.resumeSnapshot?.title === resume.title);
    return {
      kicker: 'Continue where you left off',
      icon: FileText,
      title: resume.title,
      meta: `Resume · edited ${timeAgo(resume.updatedAt)}`,
      to: analysed ? `/app/resumes/${resume._id}` : `/app/analyses?resume=${resume._id}`,
      cta: analysed ? 'Open in editor' : 'Match it to a job',
      secondary: analysed ? null : { to: `/app/resumes/${resume._id}`, label: 'Edit' },
    };
  }
  return {
    kicker: 'Your first step',
    icon: Plus,
    title: 'Create your first resume',
    meta: 'A guided template with a live preview. You can import an existing file too.',
    to: '/app/resumes?new=1',
    cta: 'Create resume',
  };
}

function ContinueCard({ action }) {
  const Icon = action.icon;
  return (
    <div className="continue-card">
      <span className="section-title">{action.kicker}</span>
      <div className="row" style={{ flexWrap: 'nowrap', gap: 12, alignItems: 'flex-start' }}>
        <span className="row-icon" style={{ background: 'var(--accent-soft)', color: 'var(--accent)', borderColor: 'var(--accent-border)' }}>
          <Icon size={16} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div className="title">{action.title}</div>
          <div className="xsmall muted">{action.meta}</div>
        </div>
      </div>
      <div className="row">
        <Link className="btn btn-primary" to={action.to}>
          {action.cta} <ArrowRight size={15} />
        </Link>
        {action.secondary && (
          <Link className="btn btn-ghost" to={action.secondary.to}>
            {action.secondary.label}
          </Link>
        )}
      </div>
    </div>
  );
}

function Journey({ counts }) {
  const steps = [
    { icon: FileText, title: 'Build a resume', desc: 'Structured sections, live preview, PDF/DOCX.', done: counts.resumes > 0, doneText: `${counts.resumes} saved`, to: '/app/resumes' },
    { icon: Target, title: 'Match a job', desc: 'Find matched skills and real gaps.', done: counts.analyses > 0, doneText: `${counts.analyses} analysis${counts.analyses === 1 ? '' : 'es'}`, to: '/app/analyses' },
    { icon: MessageSquare, title: 'Practise an interview', desc: '12 questions with a live AI interviewer.', done: counts.completedInterviews > 0, doneText: `${counts.completedInterviews} completed`, to: '/app/interviews' },
  ];
  const nextIndex = steps.findIndex((s) => !s.done);
  return (
    <nav className="journey" aria-label="Preparation steps">
      {steps.map((s, i) => {
        const Icon = s.done ? CheckCircle2 : s.icon;
        return (
          <Link key={s.title} to={s.to} className={`journey-step${s.done ? ' done' : ''}`}>
            <span className="step-icon">
              <Icon size={17} />
            </span>
            <span>
              <b>{s.title}</b>
              <span className="desc">{s.desc}</span>
              <span className="status">
                {s.done ? s.doneText : i === nextIndex ? 'Next step' : 'Not started'}
                {!s.done && <ArrowRight size={12} />}
              </span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

export function DashboardPage() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useApiData('/api/dashboard');
  const firstName = user.fullName.split(' ')[0];
  const hasData = data && (data.counts.resumes || data.counts.analyses || data.counts.interviews);

  return (
    <div className="page">
      {error ? (
        <div className="card">
          <ErrorState error={error} onRetry={reload} />
        </div>
      ) : (
        <>
          <section className="welcome" aria-labelledby="welcome-title">
            <div>
              <h1 id="welcome-title">
                {greeting()}, {firstName}
              </h1>
              <p className="lead">{hasData ? 'Here is where your preparation stands.' : 'Welcome to RoleFit AI. Three steps take you from a blank page to interview practice.'}</p>
              {hasData ? (
                <div className="stat-strip" aria-label="Your totals">
                  <div>
                    <strong>{data.counts.resumes}</strong>
                    <span>Resumes</span>
                  </div>
                  <div>
                    <strong>{data.counts.analyses}</strong>
                    <span>Job analyses</span>
                  </div>
                  <div>
                    <strong>{data.counts.completedInterviews}</strong>
                    <span>Interviews completed</span>
                  </div>
                </div>
              ) : null}
            </div>
            {loading && !data ? (
              <div className="continue-card">
                <Skeleton width="40%" height={12} />
                <Skeleton width="80%" height={18} />
                <Skeleton width="50%" height={36} />
              </div>
            ) : (
              data && <ContinueCard action={nextAction(data)} />
            )}
          </section>

          {data && <Journey counts={data.counts} />}

          <div className="grid-main-side">
            <div className="stack" style={{ gap: 20 }}>
              <section className="card" aria-labelledby="recent-resumes">
                <div className="card-header">
                  <h2 id="recent-resumes">
                    <FileText size={16} /> Recent resumes
                  </h2>
                  <Link to="/app/resumes" className="small">
                    View all
                  </Link>
                </div>
                {loading && !data ? (
                  <SkeletonList />
                ) : data?.recentResumes.length ? (
                  <ul className="list">
                    {data.recentResumes.map((r) => (
                      <li className="list-row interactive" key={r._id}>
                        <span className="row-icon" aria-hidden="true">
                          <FileText size={15} />
                        </span>
                        <div className="grow">
                          <Link className="title" to={`/app/resumes/${r._id}`}>
                            {r.title}
                          </Link>
                          <span className="meta">
                            {r.personal?.headline || 'No headline'} · edited {timeAgo(r.updatedAt)}
                          </span>
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
                  <h2 id="recent-analyses">
                    <Target size={16} /> Recent job matches
                  </h2>
                  <Link to="/app/analyses" className="small">
                    View all
                  </Link>
                </div>
                {loading && !data ? (
                  <SkeletonList />
                ) : data?.recentAnalyses.length ? (
                  <ul className="list">
                    {data.recentAnalyses.map((a) => (
                      <li className="list-row interactive" key={a._id}>
                        <div className="grow">
                          <Link className="title" to={`/app/analyses/${a._id}`}>
                            {a.targetRole || 'Untitled role'}
                          </Link>
                          <span className="meta">
                            {a.resumeSnapshot?.title} · {formatDate(a.createdAt)} · {a.missingSkills?.length || 0} skills not found
                          </span>
                        </div>
                        <div style={{ width: 120 }} className="stack" aria-label={a.scores?.skillCoverage != null ? `Skill coverage ${a.scores.skillCoverage}%` : 'Skill coverage not measurable'}>
                          <span className="xsmall muted tabular" style={{ textAlign: 'right', gap: 0 }}>
                            {a.scores?.skillCoverage != null ? `${a.scores.skillCoverage}% skill coverage` : 'No skills detected'}
                          </span>
                          {a.scores?.skillCoverage != null && <Meter value={a.scores.skillCoverage} label="Skill coverage" />}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState icon={Target} title="No job matches yet" action={<Link className="btn btn-primary btn-sm" to="/app/analyses">Analyze a job</Link>}>
                    Compare a resume with a real job description to see your skill gaps.
                  </EmptyState>
                )}
              </section>
            </div>

            <div className="stack" style={{ gap: 20 }}>
              <section className="card" aria-labelledby="recent-interviews">
                <div className="card-header">
                  <h2 id="recent-interviews">
                    <MessageSquare size={16} /> Mock interviews
                  </h2>
                  <Link to="/app/interviews" className="small">
                    View all
                  </Link>
                </div>
                {loading && !data ? (
                  <SkeletonList rows={2} />
                ) : data?.recentInterviews.length ? (
                  <ul className="list">
                    {data.recentInterviews.map((i) => (
                      <li className="list-row interactive" key={i._id}>
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
                  <EmptyState icon={MessageSquare} title="No interviews yet" action={<Link className="btn btn-sm" to="/app/interviews">Set up an interview</Link>}>
                    Practise with an AI interviewer and review feedback on every answer.
                  </EmptyState>
                )}
                {data?.interviewScores.length > 1 && (
                  <div className="card-body" style={{ borderTop: '1px solid var(--border)' }}>
                    <div className="score-bars">
                      <span className="section-title">Completed interview scores · oldest first</span>
                      {data.interviewScores.map((s) => (
                        <div className="score-bar" key={s.id}>
                          <span className="xsmall muted" title={s.targetRole}>
                            {formatDate(s.completedAt)}
                          </span>
                          <Meter value={s.score ?? 0} tone="success" label={`Score for ${s.targetRole}`} />
                          <b className="small tabular">{s.score ?? '—'}</b>
                        </div>
                      ))}
                      <span className="xsmall muted">AI-assisted practice estimates, not assessments.</span>
                    </div>
                  </div>
                )}
              </section>

              {data?.activity?.length > 0 && (
                <section className="card" aria-labelledby="activity">
                  <div className="card-header">
                    <h2 id="activity">Recent activity</h2>
                  </div>
                  <div className="card-body" style={{ paddingTop: 10, paddingBottom: 10 }}>
                    <ul className="activity">
                      {data.activity.map((a) => (
                        <li key={`${a.type}-${a.id}-${a.at}`}>
                          <span>{a.label}</span>
                          <span className="when">{timeAgo(a.at)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </section>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
