import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, CircleDot, Info, ListChecks, Pencil, Star, Target, Type } from 'lucide-react';
import { Badge, Ring } from '../../components/ui.jsx';
import { formatDateTime } from '../../lib/format.js';

const SEVERITY = {
  high: { label: 'Important', tone: 'tone-danger', icon: AlertTriangle, color: 'var(--danger)' },
  medium: { label: 'Recommended', tone: 'tone-warning', icon: CircleDot, color: 'var(--warning)' },
  low: { label: 'Optional', tone: '', icon: Info, color: 'var(--muted)' },
};
const ORDER = { high: 0, medium: 1, low: 2 };

function SuggestionList({ items, empty }) {
  if (!items?.length) return <p className="muted small">{empty}</p>;
  const sorted = [...items].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
  return (
    <ul className="suggestions">
      {sorted.map((s) => {
        const sev = SEVERITY[s.severity] || SEVERITY.low;
        const Icon = sev.icon;
        return (
          <li key={s.id}>
            <details>
              <summary>
                <Icon size={15} color={sev.color} aria-hidden="true" />
                <span className="s-title">{s.title}</span>
                <Badge tone={sev.tone}>{sev.label}</Badge>
              </summary>
              <div className="s-body">
                <p>{s.detail}</p>
                {s.why && (
                  <p className="why">
                    <b>Why it matters:</b> {s.why}
                  </p>
                )}
              </div>
            </details>
          </li>
        );
      })}
    </ul>
  );
}

export function AnalysisResult({ analysis }) {
  const priorities = Object.fromEntries((analysis.missingSkillPriorities || []).map((p) => [p.skill, p.priority]));
  const required = analysis.missingSkills.filter((s) => priorities[s] !== 'preferred');
  const preferred = analysis.missingSkills.filter((s) => priorities[s] === 'preferred');
  const totalSkills = analysis.matchedSkills.length + analysis.missingSkills.length;
  const totalKeywords = analysis.matchedKeywords.length + analysis.missingKeywords.length;
  const skill = analysis.scores?.skillCoverage;
  const keyword = analysis.scores?.keywordCoverage;

  // A factual one-line readout derived only from the counts above.
  const readout = totalSkills
    ? `Your resume shows ${analysis.matchedSkills.length} of the ${totalSkills} skills this posting mentions.${required.length ? ` ${required.length} required skill${required.length === 1 ? ' was' : 's were'} not found.` : ' No required skills are missing.'}`
    : 'This posting mentions no skills from our dictionary, so only keyword coverage is measured.';

  return (
    <div className="stack" style={{ gap: 20 }}>
      <section className="card match-summary" aria-labelledby="match-title">
        <div className="match-summary-main">
          <span className="section-title">Job match</span>
          <h1 id="match-title">{analysis.targetRole || 'Untitled role'}</h1>
          <p className="small muted">
            Resume: <b style={{ color: 'var(--text-2)', fontWeight: 550 }}>{analysis.resumeSnapshot?.title || 'deleted resume'}</b> · {formatDateTime(analysis.createdAt)}
          </p>
          <p className="readout">{readout}</p>
          <div className="row">
            {analysis.resume && (
              <Link className="btn" to={`/app/resumes/${analysis.resume}`}>
                <Pencil size={15} /> Edit this resume
              </Link>
            )}
          </div>
        </div>
        <div className="match-rings">
          <div className="ring-block">
            <Ring value={skill} label="Skill coverage" tone={skill >= 70 ? 'success' : skill >= 40 ? 'accent' : 'warning'} />
            <div>
              <b>Skill coverage</b>
              <span>{totalSkills ? `${analysis.matchedSkills.length} of ${totalSkills} job skills found` : 'Not measurable'}</span>
            </div>
          </div>
          <div className="ring-block">
            <Ring value={keyword} label="Keyword coverage" />
            <div>
              <b>Keyword coverage</b>
              <span>{totalKeywords ? `${analysis.matchedKeywords.length} of ${totalKeywords} frequent terms found` : 'Not measurable'}</span>
            </div>
          </div>
        </div>
      </section>

      <details className="disclosure">
        <summary>
          <Info size={15} /> How this matching works — and what it does not measure
        </summary>
        <div className="disclosure-body stack" style={{ gap: 6 }}>
          <p>{analysis.method?.description}</p>
          <p className="muted">
            Method: {analysis.method?.name} v{analysis.method?.version}. Recruiters and real applicant tracking systems weigh many other factors; high coverage does not guarantee a shortlist.
          </p>
        </div>
      </details>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <section className="card" aria-labelledby="matched-skills">
          <div className="card-header">
            <h2 id="matched-skills">
              <CheckCircle2 size={16} color="var(--success)" /> Skills you demonstrate
            </h2>
            <Badge tone="tone-success">{analysis.matchedSkills.length}</Badge>
          </div>
          {analysis.evidence?.length ? (
            <table className="evidence-table">
              <thead>
                <tr>
                  <th scope="col">Skill</th>
                  <th scope="col">Where it appears in your resume</th>
                </tr>
              </thead>
              <tbody>
                {analysis.evidence.map((e) => {
                  const onlyList = e.sources.every((s) => s.section === 'Skills');
                  return (
                    <tr key={e.skill}>
                      <td>
                        <span className="chip tone-success">{e.skill}</span>
                      </td>
                      <td>
                        <div className="chip-list">
                          {e.sources.map((s, i) => (
                            <span key={i} className="src" title={s.label}>
                              {s.section}
                              {s.section !== 'Skills' && s.label !== s.section ? <em> · {s.label}</em> : null}
                            </span>
                          ))}
                          {onlyList && <span className="src warn">skills list only</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="card-body muted small">None of this job’s skills were found in your resume yet.</div>
          )}
        </section>

        <div className="stack" style={{ gap: 20 }}>
          <section className="card" aria-labelledby="missing-skills">
            <div className="card-header">
              <h2 id="missing-skills">
                <AlertTriangle size={16} color="var(--warning)" /> Skills not found
              </h2>
              <Badge tone={analysis.missingSkills.length ? 'tone-warning' : 'tone-success'}>{analysis.missingSkills.length}</Badge>
            </div>
            <div className="card-body stack">
              {required.length > 0 && (
                <div className="stack" style={{ gap: 8 }}>
                  <span className="section-title">Required or unspecified</span>
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
                  <span className="section-title">Preferred / nice to have</span>
                  <div className="chip-list">
                    {preferred.map((s) => (
                      <span className="chip" key={s}>
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {!analysis.missingSkills.length && <p className="small muted">Your resume mentions every skill we detected in this posting.</p>}
              <p className="xsmall muted">Add a skill only if you have genuinely used it. Otherwise treat it as a learning goal.</p>
            </div>
          </section>

          {analysis.emphasize?.length > 0 && (
            <section className="card" aria-labelledby="emphasize">
              <div className="card-header">
                <h2 id="emphasize">
                  <Star size={16} /> Lead with these entries
                </h2>
              </div>
              <ul className="list">
                {analysis.emphasize.map((e) => (
                  <li className="list-row" key={`${e.section}-${e.label}`} style={{ alignItems: 'flex-start' }}>
                    <div className="grow">
                      <span className="title">{e.label}</span>
                      <span className="meta">
                        {e.section} · shows {e.matchedSkills.length} job skill{e.matchedSkills.length === 1 ? '' : 's'}
                      </span>
                      <div className="chip-list" style={{ marginTop: 8 }}>
                        {e.matchedSkills.map((s) => (
                          <span className="chip tone-accent" key={s}>
                            {s}
                          </span>
                        ))}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <section className="card" aria-labelledby="next-steps">
          <div className="card-header">
            <h2 id="next-steps">
              <Target size={16} /> Next steps for this job
            </h2>
            <span className="xsmall muted">Select a step for details</span>
          </div>
          <SuggestionList items={analysis.suggestions} empty="Nothing to flag for this job." />
        </section>
        <section className="card" aria-labelledby="checklist">
          <div className="card-header">
            <h2 id="checklist">
              <ListChecks size={16} /> Resume quality checklist
            </h2>
            <Badge>{analysis.checklist?.length || 0}</Badge>
          </div>
          <SuggestionList items={analysis.checklist} empty="No structural issues found in this resume." />
        </section>
      </div>

      {(analysis.matchedKeywords.length > 0 || analysis.missingKeywords.length > 0) && (
        <section className="card" aria-labelledby="keywords">
          <div className="card-header">
            <h2 id="keywords">
              <Type size={16} /> Frequent job-description terms
            </h2>
            <span className="xsmall muted">Mirror only where accurate</span>
          </div>
          <div className="card-body grid-2">
            <div className="stack" style={{ gap: 8 }}>
              <span className="section-title">Also in your resume</span>
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
              <span className="section-title">Not in your resume</span>
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
