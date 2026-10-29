// Converts a structured resume into plain text. The layout (name, headline,
// contact lines, then upper-case headings with "A | B" entries and "- " bullets)
// matches what the Python AI service's parser and DOCX renderer expect.

const join = (parts, sep = ' | ') => parts.map((p) => (p || '').trim()).filter(Boolean).join(sep);
const range = (start, end, current) => join([start, current ? 'Present' : end], ' - ');

export function resumeToText(resume) {
  const r = resume || {};
  const p = r.personal || {};
  const out = [];
  out.push(p.fullName || r.title || 'Candidate');
  if (p.headline) out.push(p.headline);
  const contact = join([p.email, p.phone, p.location]);
  if (contact) out.push(contact);
  const links = join([
    p.linkedin && `LinkedIn: ${p.linkedin}`,
    p.github && `GitHub: ${p.github}`,
    p.website && `Website: ${p.website}`,
  ]);
  if (links) out.push(links);

  const section = (heading, lines) => {
    const clean = lines.filter((l) => l && l.trim());
    if (clean.length) out.push('', heading, ...clean);
  };

  section('SUMMARY', [r.summary]);

  const technical = r.skills?.technical || [];
  const interpersonal = r.skills?.interpersonal || [];
  section('SKILLS', [
    technical.length ? `Technical: ${technical.join(', ')}` : '',
    interpersonal.length ? `Interpersonal: ${interpersonal.join(', ')}` : '',
  ]);

  section(
    'EXPERIENCE',
    (r.experience || []).flatMap((e) => [
      join([e.role, e.organization, e.location, range(e.startDate, e.endDate, e.current)]),
      ...(e.bullets || []).filter(Boolean).map((b) => `- ${b}`),
    ]),
  );

  section(
    'PROJECTS',
    (r.projects || []).flatMap((pr) => [
      join([pr.name, pr.role, (pr.technologies || []).join(', '), range(pr.startDate, pr.endDate)]),
      ...(pr.link ? [`Link: ${pr.link}`] : []),
      ...(pr.bullets || []).filter(Boolean).map((b) => `- ${b}`),
    ]),
  );

  section(
    'EDUCATION',
    (r.education || []).flatMap((ed) => [
      join([ed.institution, join([ed.degree, ed.field], ', '), ed.location, range(ed.startDate, ed.endDate), ed.grade && `Grade: ${ed.grade}`]),
      ...(ed.details ? [`- ${ed.details}`] : []),
    ]),
  );

  section('CERTIFICATIONS', (r.certifications || []).map((c) => join([c.name, c.issuer, c.date])));
  section('ACHIEVEMENTS', (r.achievements || []).map((a) => join([a.title, a.description, a.date])));
  section('LINKS', (r.links || []).map((l) => join([l.label, l.url], ': ')));

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
