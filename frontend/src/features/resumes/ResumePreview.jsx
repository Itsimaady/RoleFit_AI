import { useEffect, useRef, useState } from 'react';

const PAPER_WIDTH = 816; // 8.5in at 96 dpi, same page size as the PDF export.

const join = (parts, sep = ' | ') => parts.map((p) => (p || '').trim()).filter(Boolean).join(sep);
const range = (start, end, current) => join([start, current ? 'Present' : end], ' – ');

function Entry({ title, subtitle, dates, bullets }) {
  const items = (bullets || []).filter((b) => b && b.trim());
  return (
    <div>
      <div className="entry-line">
        <b>{title}</b>
        {dates && <span className="dates">{dates}</span>}
      </div>
      {subtitle && <div className="sub">{subtitle}</div>}
      {items.length > 0 && (
        <ul>
          {items.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** HTML live preview mirroring the server-side PDF templates. */
export function ResumePaper({ resume }) {
  const p = resume.personal || {};
  const technical = resume.skills?.technical || [];
  const interpersonal = resume.skills?.interpersonal || [];
  const contact = join([p.email, p.phone, p.location]);
  const links = join([p.linkedin, p.github, p.website]);
  const empty = !p.fullName && !resume.summary && !resume.experience?.length && !resume.education?.length && !resume.projects?.length;

  return (
    <article className={`paper template-${resume.template || 'classic'}`} aria-label="Resume preview">
      <h1>{p.fullName || <span className="placeholder">Your name</span>}</h1>
      {p.headline && <div className="headline">{p.headline}</div>}
      {contact && <div className="contact">{contact}</div>}
      {links && <div className="contact">{links}</div>}
      {empty && <p className="placeholder" style={{ marginTop: 24, textAlign: 'center' }}>Start filling in sections on the left — the preview updates as you type.</p>}

      {resume.summary && (
        <section>
          <h2>Summary</h2>
          <p>{resume.summary}</p>
        </section>
      )}
      {(technical.length > 0 || interpersonal.length > 0) && (
        <section>
          <h2>Skills</h2>
          {technical.length > 0 && (
            <p>
              <b>Technical:</b> {technical.join(', ')}
            </p>
          )}
          {interpersonal.length > 0 && (
            <p>
              <b>Interpersonal:</b> {interpersonal.join(', ')}
            </p>
          )}
        </section>
      )}
      {resume.experience?.length > 0 && (
        <section>
          <h2>Experience</h2>
          {resume.experience.map((e) => (
            <Entry key={e._key || e._id} title={join([e.role, e.organization], ', ')} subtitle={join([e.type, e.location])} dates={range(e.startDate, e.endDate, e.current)} bullets={e.bullets} />
          ))}
        </section>
      )}
      {resume.projects?.length > 0 && (
        <section>
          <h2>Projects</h2>
          {resume.projects.map((pr) => (
            <Entry key={pr._key || pr._id} title={join([pr.name, pr.role], ', ')} subtitle={join([(pr.technologies || []).join(', '), pr.link])} dates={range(pr.startDate, pr.endDate)} bullets={pr.bullets} />
          ))}
        </section>
      )}
      {resume.education?.length > 0 && (
        <section>
          <h2>Education</h2>
          {resume.education.map((ed) => (
            <Entry
              key={ed._key || ed._id}
              title={ed.institution}
              subtitle={join([join([ed.degree, ed.field], ', '), ed.grade && `Grade: ${ed.grade}`, ed.location])}
              dates={range(ed.startDate, ed.endDate)}
              bullets={ed.details ? [ed.details] : []}
            />
          ))}
        </section>
      )}
      {resume.certifications?.length > 0 && (
        <section>
          <h2>Certifications</h2>
          <ul>
            {resume.certifications.map((c) => (
              <li key={c._key || c._id}>{join([c.name, c.issuer, c.date], ' – ')}</li>
            ))}
          </ul>
        </section>
      )}
      {resume.achievements?.length > 0 && (
        <section>
          <h2>Achievements</h2>
          <ul>
            {resume.achievements.map((a) => (
              <li key={a._key || a._id}>{join([a.title, a.description, a.date], ' – ')}</li>
            ))}
          </ul>
        </section>
      )}
      {resume.links?.length > 0 && (
        <section>
          <h2>Links</h2>
          <ul>
            {resume.links.map((l) => (
              <li key={l._key || l._id}>{join([l.label, l.url], ': ')}</li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}

/** Scales the fixed-width paper to fit its container. */
export function ResumePreview({ resume }) {
  const frameRef = useRef(null);
  const paperRef = useRef(null);
  const [scale, setScale] = useState(0.6);
  const [height, setHeight] = useState(1056 * 0.6);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || typeof ResizeObserver === 'undefined') return undefined;
    const update = () => {
      const s = Math.min(1, frame.clientWidth / PAPER_WIDTH);
      setScale(s);
      setHeight((paperRef.current?.offsetHeight || 1056) * s);
    };
    const observer = new ResizeObserver(update);
    observer.observe(frame);
    if (paperRef.current) observer.observe(paperRef.current);
    update();
    return () => observer.disconnect();
  }, []);

  return (
    <div className="paper-frame" ref={frameRef} style={{ height }}>
      <div ref={paperRef} style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: PAPER_WIDTH }}>
        <ResumePaper resume={resume} />
      </div>
    </div>
  );
}
