import { useState } from 'react';
import { ArrowDown, ArrowUp, Check, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Button, Field, TextField } from '../../components/ui.jsx';
import { blank, tempKey } from './resumeModel.js';

/* ---------- Primitive editors ---------- */

export function TagInput({ label, values, onChange, placeholder, hint, max = 60 }) {
  const [draft, setDraft] = useState('');
  const add = (raw) => {
    const parts = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.length) return;
    const lower = new Set(values.map((v) => v.toLowerCase()));
    const next = [...values];
    for (const p of parts) {
      if (!lower.has(p.toLowerCase()) && next.length < max) {
        next.push(p.slice(0, 50));
        lower.add(p.toLowerCase());
      }
    }
    onChange(next);
    setDraft('');
  };
  return (
    <Field label={label} hint={hint ?? 'Press Enter or comma to add. Backspace removes the last one.'}>
      {(a11y) => (
        <div className="tags">
          {values.map((v, i) => (
            <span className="chip" key={`${v}-${i}`}>
              {v}
              <button type="button" onClick={() => onChange(values.filter((_, j) => j !== i))} aria-label={`Remove ${v}`}>
                <X size={13} />
              </button>
            </span>
          ))}
          <input
            {...a11y}
            value={draft}
            placeholder={values.length ? '' : placeholder}
            onChange={(e) => (e.target.value.endsWith(',') ? add(e.target.value) : setDraft(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add(draft);
              } else if (e.key === 'Backspace' && !draft && values.length) {
                onChange(values.slice(0, -1));
              }
            }}
            onBlur={() => add(draft)}
          />
        </div>
      )}
    </Field>
  );
}

function BulletEditor({ bullets, onChange, context, jobHint, label = 'Bullet points', errors = {}, prefix }) {
  const toast = useToast();
  const [suggesting, setSuggesting] = useState(null);
  const [suggestions, setSuggestions] = useState({});
  const list = bullets.length ? bullets : [''];

  const set = (i, value) => onChange(list.map((b, j) => (j === i ? value : b)));

  const suggest = async (i) => {
    const text = list[i].trim();
    if (text.length < 5) return toast.info('Write at least a few words first; the AI only rewrites what you provide.');
    setSuggesting(i);
    try {
      const res = await api.post('/api/ai/rewrite-bullet', { text, context, jobDescription: jobHint || '' });
      setSuggestions((s) => ({ ...s, [i]: res }));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSuggesting(null);
    }
  };

  const resolve = (i, accept) => {
    if (accept) set(i, suggestions[i].suggestion);
    setSuggestions(({ [i]: _drop, ...rest }) => rest);
  };

  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="bullets">
        {list.map((b, i) => (
          <div key={i} className="stack" style={{ gap: 6 }}>
            <div className="bullet-row">
              <label className="sr-only" htmlFor={`${prefix}-b${i}`}>
                {label} {i + 1}
              </label>
              <textarea
                id={`${prefix}-b${i}`}
                className="textarea"
                rows={2}
                value={b}
                maxLength={400}
                placeholder="Start with an action verb: Built, Designed, Automated…"
                aria-invalid={errors[`${prefix}.bullets.${i}`] ? true : undefined}
                onChange={(e) => set(i, e.target.value)}
              />
              <div className="stack" style={{ gap: 4 }}>
                <Button size="sm" variant="ghost" className="btn-icon" onClick={() => suggest(i)} loading={suggesting === i} aria-label={`Suggest a clearer version of bullet ${i + 1}`} title="Suggest clearer wording (AI)">
                  {suggesting !== i && <Sparkles size={15} />}
                </Button>
                <Button size="sm" variant="ghost" className="btn-icon" onClick={() => onChange(list.filter((_, j) => j !== i))} aria-label={`Remove bullet ${i + 1}`} title="Remove" disabled={list.length === 1 && !b}>
                  <Trash2 size={15} />
                </Button>
              </div>
            </div>
            {suggestions[i] && (
              <div className="suggestion" role="status">
                <span className="label">
                  <Sparkles size={13} /> AI suggestion — check every fact before accepting
                </span>
                <span>{suggestions[i].suggestion}</span>
                {suggestions[i].notes && <span className="small muted">{suggestions[i].notes}</span>}
                <div className="row">
                  <Button size="sm" variant="primary" onClick={() => resolve(i, true)}>
                    <Check size={14} /> Use suggestion
                  </Button>
                  <Button size="sm" onClick={() => resolve(i, false)}>
                    Keep mine
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      <div>
        <Button size="sm" onClick={() => onChange([...list, ''])} disabled={list.length >= 10}>
          <Plus size={14} /> Add bullet
        </Button>
      </div>
    </div>
  );
}

/* ---------- Repeatable entry list ---------- */

function EntryList({ section, items, onChange, render, titleOf, addLabel, max, emptyText }) {
  const update = (index, patch) => onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  const move = (index, delta) => {
    const next = [...items];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    onChange(next);
  };
  return (
    <div className="stack">
      {items.length === 0 && <p className="muted">{emptyText}</p>}
      {items.map((item, index) => (
        <fieldset className="entry" key={item._key} style={{ margin: 0 }}>
          <legend className="sr-only">
            {addLabel.replace('Add ', '')} {index + 1}
          </legend>
          <div className="entry-head">
            <b>{titleOf(item) || `New ${addLabel.replace('Add ', '').toLowerCase()}`}</b>
            <Button size="sm" variant="ghost" className="btn-icon" onClick={() => move(index, -1)} disabled={index === 0} aria-label="Move up" title="Move up">
              <ArrowUp size={15} />
            </Button>
            <Button size="sm" variant="ghost" className="btn-icon" onClick={() => move(index, 1)} disabled={index === items.length - 1} aria-label="Move down" title="Move down">
              <ArrowDown size={15} />
            </Button>
            <Button size="sm" variant="ghost" className="btn-icon" onClick={() => onChange(items.filter((_, i) => i !== index))} aria-label={`Remove ${titleOf(item) || 'entry'}`} title="Remove">
              <Trash2 size={15} />
            </Button>
          </div>
          {render(item, (patch) => update(index, patch), index)}
        </fieldset>
      ))}
      <div>
        <Button onClick={() => onChange([...items, { ...blank[section](), _key: tempKey() }])} disabled={items.length >= max}>
          <Plus size={16} /> {addLabel}
        </Button>
      </div>
    </div>
  );
}

const input = (item, patch, key, label, props = {}) => (
  <TextField label={label} value={item[key] ?? ''} onChange={(e) => patch({ [key]: e.target.value })} {...props} />
);

/* ---------- Section forms ---------- */

export function PersonalForm({ resume, setResume, errors }) {
  const p = resume.personal;
  const set = (key) => (e) => setResume((r) => ({ ...r, personal: { ...r.personal, [key]: e.target.value } }));
  const f = (key, label, props = {}) => <TextField label={label} value={p[key]} onChange={set(key)} error={errors[`personal.${key}`]} {...props} />;
  return (
    <div className="form-grid">
      {f('fullName', 'Full name', { autoComplete: 'name', maxLength: 80 })}
      {f('headline', 'Headline', { placeholder: 'Computer Science Student | Backend Developer', maxLength: 120 })}
      {f('email', 'Email', { type: 'email', autoComplete: 'email', maxLength: 254 })}
      {f('phone', 'Phone', { type: 'tel', autoComplete: 'tel', placeholder: '+91 98765 43210', maxLength: 40 })}
      {f('location', 'Location', { placeholder: 'City, Country', maxLength: 120 })}
      {f('linkedin', 'LinkedIn', { placeholder: 'linkedin.com/in/you', maxLength: 300 })}
      {f('github', 'GitHub', { placeholder: 'github.com/you', maxLength: 300 })}
      {f('website', 'Portfolio / website', { placeholder: 'you.dev', maxLength: 300 })}
    </div>
  );
}

export function SummaryForm({ resume, setResume }) {
  const words = resume.summary.trim() ? resume.summary.trim().split(/\s+/).length : 0;
  return (
    <TextField
      label="Professional summary"
      multiline
      rows={6}
      maxLength={1500}
      value={resume.summary}
      onChange={(e) => setResume((r) => ({ ...r, summary: e.target.value }))}
      hint={`${words} words. Aim for 30–70: your focus area, strongest skills and the role you want.`}
      placeholder="Final-year computer science student focused on backend development with Python and Node.js…"
    />
  );
}

export function SkillsForm({ resume, setResume }) {
  const set = (key) => (values) => setResume((r) => ({ ...r, skills: { ...r.skills, [key]: values } }));
  return (
    <div className="stack">
      <TagInput label="Technical skills" values={resume.skills.technical} onChange={set('technical')} placeholder="Python, React, SQL…" />
      <TagInput label="Interpersonal skills" values={resume.skills.interpersonal} onChange={set('interpersonal')} placeholder="Communication, Teamwork…" max={30} />
      <p className="small muted">List only skills you can discuss confidently in an interview.</p>
    </div>
  );
}

const listSetter = (setResume, key) => (items) => setResume((r) => ({ ...r, [key]: items }));

export function EducationForm({ resume, setResume, errors }) {
  return (
    <EntryList
      section="education"
      items={resume.education}
      onChange={listSetter(setResume, 'education')}
      addLabel="Add education"
      max={10}
      emptyText="Add your degree, school or university."
      titleOf={(e) => e.institution}
      render={(e, patch, i) => (
        <div className="form-grid">
          {input(e, patch, 'institution', 'Institution', { className: 'span-2', maxLength: 150 })}
          {input(e, patch, 'degree', 'Degree', { placeholder: 'B.Tech', maxLength: 120 })}
          {input(e, patch, 'field', 'Field of study', { placeholder: 'Computer Science', maxLength: 120 })}
          {input(e, patch, 'startDate', 'Start', { placeholder: 'Aug 2022', maxLength: 30 })}
          {input(e, patch, 'endDate', 'End (or expected)', { placeholder: 'May 2026', maxLength: 30 })}
          {input(e, patch, 'grade', 'Grade', { placeholder: 'CGPA 8.4/10', maxLength: 40 })}
          {input(e, patch, 'location', 'Location', { maxLength: 120 })}
          {input(e, patch, 'details', 'Details (optional)', { className: 'span-2', multiline: true, rows: 2, maxLength: 500, placeholder: 'Relevant coursework, honours…', error: errors[`education.${i}.details`] })}
        </div>
      )}
    />
  );
}

export function ExperienceForm({ resume, setResume, errors }) {
  return (
    <EntryList
      section="experience"
      items={resume.experience}
      onChange={listSetter(setResume, 'experience')}
      addLabel="Add experience"
      max={15}
      emptyText="Internships, part-time jobs, research or volunteer roles all count."
      titleOf={(e) => [e.role, e.organization].filter(Boolean).join(' at ')}
      render={(e, patch, i) => (
        <div className="form-grid">
          {input(e, patch, 'role', 'Role', { placeholder: 'Software Engineering Intern', maxLength: 120 })}
          {input(e, patch, 'organization', 'Organization', { maxLength: 150 })}
          {input(e, patch, 'type', 'Type', { placeholder: 'Internship', maxLength: 40 })}
          {input(e, patch, 'location', 'Location', { placeholder: 'Remote', maxLength: 120 })}
          {input(e, patch, 'startDate', 'Start', { placeholder: 'Jun 2025', maxLength: 30 })}
          <div className="stack" style={{ gap: 6 }}>
            {input(e, patch, 'endDate', 'End', { placeholder: 'Aug 2025', maxLength: 30, disabled: e.current })}
            <label className="checkbox">
              <input type="checkbox" checked={e.current} onChange={(ev) => patch({ current: ev.target.checked, endDate: ev.target.checked ? '' : e.endDate })} /> I currently work here
            </label>
          </div>
          <div className="span-2">
            <BulletEditor bullets={e.bullets} onChange={(bullets) => patch({ bullets })} context={[e.role, e.organization].filter(Boolean).join(' at ')} errors={errors} prefix={`experience.${i}`} />
          </div>
        </div>
      )}
    />
  );
}

export function ProjectsForm({ resume, setResume, errors }) {
  return (
    <EntryList
      section="projects"
      items={resume.projects}
      onChange={listSetter(setResume, 'projects')}
      addLabel="Add project"
      max={15}
      emptyText="Academic, personal, hackathon or open-source projects."
      titleOf={(p) => p.name}
      render={(p, patch, i) => (
        <div className="form-grid">
          {input(p, patch, 'name', 'Project name', { maxLength: 150 })}
          {input(p, patch, 'role', 'Your role (optional)', { placeholder: 'Team lead', maxLength: 120 })}
          <div className="span-2">
            <TagInput label="Technologies" values={p.technologies} onChange={(technologies) => patch({ technologies })} placeholder="React, Node.js, MongoDB" max={25} hint="" />
          </div>
          {input(p, patch, 'link', 'Link', { placeholder: 'github.com/you/project', maxLength: 300, error: errors[`projects.${i}.link`] })}
          <div className="form-grid" style={{ gap: 12 }}>
            {input(p, patch, 'startDate', 'Start', { placeholder: 'Jan 2025', maxLength: 30 })}
            {input(p, patch, 'endDate', 'End', { placeholder: 'Mar 2025', maxLength: 30 })}
          </div>
          <div className="span-2">
            <BulletEditor bullets={p.bullets} onChange={(bullets) => patch({ bullets })} context={`Project: ${p.name}`} label="What you built and the result" errors={errors} prefix={`projects.${i}`} />
          </div>
        </div>
      )}
    />
  );
}

export function CertificationsForm({ resume, setResume, errors }) {
  return (
    <EntryList
      section="certifications"
      items={resume.certifications}
      onChange={listSetter(setResume, 'certifications')}
      addLabel="Add certification"
      max={20}
      emptyText="Optional: courses or certificates you have completed."
      titleOf={(c) => c.name}
      render={(c, patch, i) => (
        <div className="form-grid">
          {input(c, patch, 'name', 'Name', { maxLength: 150 })}
          {input(c, patch, 'issuer', 'Issuer', { placeholder: 'AWS, Coursera…', maxLength: 150 })}
          {input(c, patch, 'date', 'Date', { placeholder: 'Mar 2025', maxLength: 30 })}
          {input(c, patch, 'link', 'Credential link', { maxLength: 300, error: errors[`certifications.${i}.link`] })}
        </div>
      )}
    />
  );
}

export function AchievementsForm({ resume, setResume }) {
  return (
    <EntryList
      section="achievements"
      items={resume.achievements}
      onChange={listSetter(setResume, 'achievements')}
      addLabel="Add achievement"
      max={20}
      emptyText="Optional: awards, competition results, scholarships or leadership roles."
      titleOf={(a) => a.title}
      render={(a, patch) => (
        <div className="form-grid">
          {input(a, patch, 'title', 'Title', { maxLength: 150 })}
          {input(a, patch, 'date', 'Date', { maxLength: 30 })}
          {input(a, patch, 'description', 'Description', { className: 'span-2', multiline: true, rows: 2, maxLength: 400 })}
        </div>
      )}
    />
  );
}

export function LinksForm({ resume, setResume, errors }) {
  return (
    <EntryList
      section="links"
      items={resume.links}
      onChange={listSetter(setResume, 'links')}
      addLabel="Add link"
      max={10}
      emptyText="Optional: blog, Kaggle, LeetCode, Behance…"
      titleOf={(l) => l.label || l.url}
      render={(l, patch, i) => (
        <div className="form-grid">
          {input(l, patch, 'label', 'Label', { placeholder: 'Portfolio', maxLength: 60 })}
          {input(l, patch, 'url', 'URL', { placeholder: 'you.dev', maxLength: 300, error: errors[`links.${i}.url`] })}
        </div>
      )}
    />
  );
}

export const SECTION_FORMS = {
  personal: PersonalForm,
  summary: SummaryForm,
  education: EducationForm,
  experience: ExperienceForm,
  projects: ProjectsForm,
  skills: SkillsForm,
  certifications: CertificationsForm,
  achievements: AchievementsForm,
  links: LinksForm,
};
