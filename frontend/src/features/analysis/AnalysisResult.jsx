import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Info, ListChecks, Pencil, Sparkles, Star, Target } from 'lucide-react';
import { Badge, Meter } from '../../components/ui.jsx';
import { formatDateTime } from '../../lib/format.js';

function Coverage({ label, value, definition }) {
  return (
    <div className="card coverage-item">
      <span className="small muted" style={{ fontWeight: 600 }}>
        {label}
      </span>
      <span className="value">
        {value == null ? '—' : value}
        {value != null && <small>%</small>}
      </span>
      {value != null && <Meter value={value} tone={value >= 70 ? 'success' : value >= 40 ? '' : 'warning'} label={label} />}
      <p>{value == null ? 'The job description did not mention any skills from our dictionary, so this cannot be measured.' : definition}</p>
    </div>
  );
}

function SuggestionList({ items }) {
  if (!items?.length) return <p className="muted">Nothing to flag here.</p>;
  return (
    <ul className="suggestions">
      {items.map((s) => (
        <li key={s.id} className={`sev-${s.severity}`}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <b>{s.title}</b>
            <Badge tone={s.severity === 'high' ? 'tone-danger' : s.severity === 'medium' ? 'tone-warning' : 'tone-accent'}>{s.severity === 'high' ? 'Important' : s.severity === 'medium' ? 'Recommended' : 'Optional'}</Badge>
          </div>
          <p>{s.detail}</p>
          {s.why && <span className="why">Why it matters: {s.why}</span>}
        </li>
      ))}
    </ul>
  );
}

export function AnalysisResult({ analysis }) {
  const priorities = Object.fromEntries((analysis.missingSkillPriorities || []).map((p) => [p.skill, p.priority]));
  const required = analysis.missingSkills.filter((s) => priorities[s] !== 'preferred');
  const preferred = analysis.missingSkills.filter((s) => priorities[s] === 'preferred');

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ fontSize: 20 }}>{analysis.targetRole || 'Job analysis'}</h2>
          <p className="small muted">
            Resume: {analysis.resumeSnapshot?.title || 'deleted resume'} · {formatDateTime(analysis.createdAt)}
          </p>
        </div>
        {analysis.resume && (
          <Link className="btn" to={`/app/resumes/${analysis.resume}`}>
            <Pencil size={16} /> Edit this resume
          </Link>
        )}
      </div>

      <div className="coverage">
        <Coverage label="Skill coverage" value={analysis.scores?.skillCoverage} definition={`${analysis.matchedSkills.length} of ${analysis.matchedSkills.length + analysis.missingSkills.length} skills mentioned in the job description were found in your resume.`} />
        <Coverage label="Keyword coverage" value={analysis.scores?.keywordCoverage} definition={`${analysis.matchedKeywords.length} of ${analysis.matchedKeywords.length + analysis.missingKeywords.length} frequent job-description terms also appear in your resume.`} />
      </div>

      <details className="disclosure">
        <summary>
          <Info size={15} style={{ verticalAlign: '-2px' }} /> How this matching works (and what it does not measure)
        </summary>
        <p className="small" style={{ color: 'var(--text-2)' }}>
          {analysis.method?.description}
        </p>
        <p className="small muted" style={{ marginTop: 6 }}>
          Method: {analysis.method?.name} v{analysis.method?.version}. Recruiters and real applicant tracking systems weigh many other factors; a high coverage does not guarantee a shortlist.
        </p>
      </details>

      <div className="grid-2">
        <section className="card" aria-labelledby="matched-skills">
          <div className="card-header">
            <h3 id="matched-skills">
              <CheckCircle2 size={17} color="var(--success)" /> Skills you demonstrate
            </h3>
            <Badge tone="tone-success">{analysis.matchedSkills.length}</Badge>
          </div>
          <div className="card-body">
            {analysis.evidence?.length ? (
              <ul className="evidence-list">
                {analysis.evidence.map((e) => (
                  <li key={e.skill}>
                    <span className="chip tone-success">{e.skill}</span>
                    <span className="src">found in {e.sources.map((s) => (s.section === s.label ? s.section : `${s.section}: ${s.label}`)).join(' · ')}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">None of the job’s skills were found in your resume yet.</p>
            )}
          </div>
        </section>

        <section className="card" aria-labelledby="missing-skills">
          <div className="card-header">
            <h3 id="missing-skills">
              <AlertTriangle size={17} color="var(--warning)" /> Skills not found
            </h3>
            <Badge tone="tone-warning">{analysis.missingSkills.length}</Badge>
          </div>
          <div className="card-body stack">
            {required.length > 0 && (
              <div className="stack" style={{ gap: 8 }}>
                <span className="small" style={{ fontWeight: 600 }}>
                  Required or unspecified
                </span>
                <div className="chip-list">
                  {required.map((s) => (
                    <span className="chip tone-danger" key={s}>
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {preferred.length > 0 && (
              <div className="stack" style={{ gap: 8 }}>
                <span className="small" style={{ fontWeight: 600 }}>
                  Preferred / nice to have
                </span>
                <div className="chip-list">
                  {preferred.map((s) => (
                    <span className="chip" key={s}>
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {!analysis.missingSkills.length && <p className="muted">Your resume mentions every skill we detected in this job description.</p>}
            <p className="small muted">Add a skill only if you have genuinely used it. If you haven’t, it is a learning goal, not a resume line.</p>
          </div>
        </section>
      </div>

      {analysis.emphasize?.length > 0 && (
        <section className="card" aria-labelledby="emphasize">
          <div className="card-header">
            <h3 id="emphasize">
              <Star size={17} color="var(--accent)" /> Experience and projects to emphasize
            </h3>
          </div>
          <ul className="list">
            {analysis.emphasize.map((e) => (
              <li className="list-row" key={`${e.section}-${e.label}`}>
                <div className="grow">
                  <span className="title">{e.label}</span>
                  <span className="meta">{e.section}</span>
                </div>
                <div className="chip-list" style={{ justifyContent: 'flex-end' }}>
                  {e.matchedSkills.map((s) => (
                    <span className="chip tone-accent" key={s}>
                      {s}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid-2">
        <section className="card" aria-labelledby="next-steps">
          <div className="card-header">
            <h3 id="next-steps">
              <Target size={17} /> Next steps for this job
            </h3>
          </div>
          <div className="card-body">
            <SuggestionList items={analysis.suggestions} />
          </div>
        </section>
        <section className="card" aria-labelledby="checklist">
          <div className="card-header">
            <h3 id="checklist">
              <ListChecks size={17} /> Resume quality checklist
            </h3>
            <Badge>{analysis.checklist?.length || 0}</Badge>
          </div>
          <div className="card-body">
            {analysis.checklist?.length ? <SuggestionList items={analysis.checklist} /> : <p className="muted">No issues found in the structure of this resume.</p>}
          </div>
        </section>
      </div>

      {(analysis.matchedKeywords.length > 0 || analysis.missingKeywords.length > 0) && (
        <section className="card" aria-labelledby="keywords">
          <div className="card-header">
            <h3 id="keywords">
              <Sparkles size={17} /> Job-description terms
            </h3>
          </div>
          <div className="card-body grid-2">
            <div className="stack" style={{ gap: 8 }}>
              <span className="small" style={{ fontWeight: 600 }}>
                Also in your resume
              </span>
              <div className="chip-list">
                {analysis.matchedKeywords.map((k) => (
                  <span className="chip tone-success" key={k}>
                    {k}
                  </span>
                ))}
                {!analysis.matchedKeywords.length && <span className="muted small">None</span>}
              </div>
            </div>
            <div className="stack" style={{ gap: 8 }}>
              <span className="small" style={{ fontWeight: 600 }}>
                Not in your resume
              </span>
              <div className="chip-list">
                {analysis.missingKeywords.map((k) => (
                  <span className="chip" key={k}>
                    {k}
                  </span>
                ))}
                {!analysis.missingKeywords.length && <span className="muted small">None</span>}
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
