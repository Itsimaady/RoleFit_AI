// Job-independent resume quality checklist for students and freshers.
// Every item explains *why* it matters; nothing here invents content.

const WEAK_OPENERS = /^(worked on|responsible for|helped( with)?|assisted( with)?|involved in|did|made|handled|participated in)\b/i;

const DATE_FORMATS = [
  ['Mon YYYY', /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.? \d{4}$/i],
  ['MM/YYYY', /^\d{1,2}[/-]\d{4}$/],
  ['YYYY', /^\d{4}$/],
  ['YYYY-MM', /^\d{4}-\d{1,2}$/],
];

function dateFormat(value) {
  const v = String(value || '').trim();
  if (!v || /^(present|current|now|ongoing)$/i.test(v)) return null;
  const hit = DATE_FORMATS.find(([, re]) => re.test(v));
  return hit ? hit[0] : 'other';
}

const wordCount = (text) => (String(text || '').match(/\b[\w'+#.-]+\b/g) || []).length;

export function reviewResumeQuality(resume) {
  const items = [];
  const add = (id, severity, title, detail, why) => items.push({ id, category: 'Resume quality', severity, title, detail, why });
  const p = resume.personal || {};
  const experience = resume.experience || [];
  const projects = resume.projects || [];
  const education = resume.education || [];
  const technical = resume.skills?.technical || [];

  if (!p.fullName) add('name', 'high', 'Add your full name', 'Your name should be the first line of the resume.', 'Without a name the document cannot be attributed to you.');
  if (!p.email) add('email', 'high', 'Add an email address', 'Use a professional address you check regularly.', 'Recruiters need a reliable way to contact you.');
  if (!p.phone) add('phone', 'medium', 'Add a phone number', 'Include the country code if you are applying internationally.', 'Many recruiters call shortlisted candidates directly.');
  if (!p.linkedin && !p.github && !p.website) {
    add('links', 'low', 'Add a LinkedIn, GitHub or portfolio link', 'For technical roles, a GitHub or portfolio link lets reviewers verify your projects.', 'Links give reviewers evidence beyond the page.');
  }

  const summaryWords = wordCount(resume.summary);
  if (!summaryWords) add('summary-empty', 'low', 'Consider a short professional summary', 'Two or three sentences on your focus area, strongest skills and the role you are targeting.', 'A summary orients the reader before they reach the details.');
  else if (summaryWords > 90) add('summary-long', 'low', 'Shorten your summary', `Your summary has ${summaryWords} words; aim for 30–70.`, 'Long summaries are often skipped.');

  if (!education.length) add('education', 'high', 'Add your education', 'Include your institution, degree, field of study and dates.', 'For students and freshers, education is a primary qualification.');
  if (!experience.length && !projects.length) {
    add('no-evidence', 'high', 'Add at least one project or experience entry', 'Internships, academic projects, hackathons and open-source contributions all count.', 'Evidence of applied work is what distinguishes candidates with similar degrees.');
  }
  if (!technical.length) add('skills-empty', 'high', 'List your technical skills', 'Add the languages, frameworks and tools you can discuss confidently.', 'Skills are the first thing matched against a job description.');
  else if (technical.length > 35) add('skills-long', 'low', 'Trim your skills list', `You list ${technical.length} technical skills. Keep the ones you can discuss in an interview.`, 'Very long skill lists dilute your strongest skills.');

  const allBullets = [];
  for (const e of experience) {
    const label = [e.role, e.organization].filter(Boolean).join(' at ') || 'An experience entry';
    if (!(e.bullets || []).filter(Boolean).length) add(`exp-empty-${label}`, 'medium', `Describe what you did in "${label}"`, 'Add 2–4 bullets: what you built or improved, the tools you used and the outcome.', 'An entry without details gives the reader nothing to evaluate.');
    allBullets.push(...(e.bullets || []).map((b) => ({ text: b, label })));
  }
  for (const pr of projects) {
    const label = pr.name || 'A project';
    if (!(pr.bullets || []).filter(Boolean).length) add(`proj-empty-${label}`, 'medium', `Describe the project "${label}"`, 'Explain the problem, your contribution, the technologies and the result.', 'Project descriptions are the main evidence of skill for freshers.');
    if (!(pr.technologies || []).length) add(`proj-tech-${label}`, 'low', `List the technologies used in "${label}"`, 'Name the main languages, frameworks and services.', 'Technologies connect a project to the skills a job asks for.');
    allBullets.push(...(pr.bullets || []).map((b) => ({ text: b, label })));
  }

  const vague = allBullets.filter((b) => b.text && (wordCount(b.text) < 6 || WEAK_OPENERS.test(b.text.trim())));
  if (vague.length) {
    add('vague-bullets', 'medium', `Make ${vague.length} bullet point${vague.length > 1 ? 's' : ''} more specific`, `For example: "${vague[0].text.slice(0, 80)}" (${vague[0].label}). Start with a strong verb (built, designed, automated) and state what changed as a result.`, 'Specific bullets show ownership and impact; vague ones read as passive participation.');
  }
  const long = allBullets.filter((b) => wordCount(b.text) > 45);
  if (long.length) add('long-bullets', 'low', `Shorten ${long.length} long bullet point${long.length > 1 ? 's' : ''}`, 'Keep each bullet to one or two lines (about 15–35 words).', 'Dense bullets are hard to skim.');

  const openers = new Map();
  for (const b of allBullets) {
    const first = String(b.text || '').trim().split(/\s+/)[0]?.toLowerCase();
    if (first && first.length > 2) openers.set(first, (openers.get(first) || 0) + 1);
  }
  const repeated = [...openers.entries()].filter(([, n]) => n >= 3);
  if (repeated.length) {
    add('repeated-verbs', 'low', 'Vary how your bullet points begin', `You start ${repeated.map(([w, n]) => `${n} bullets with "${w}"`).join(' and ')}.`, 'Repetitive wording makes distinct achievements blur together.');
  }

  if (allBullets.length >= 3 && !allBullets.some((b) => /\d/.test(b.text))) {
    add('quantify', 'low', 'Add real numbers where you have them', 'If you know genuine figures (users, response time, accuracy, team size), include them. Never estimate or invent metrics.', 'Accurate numbers make impact concrete; invented ones are easily exposed in interviews.');
  }

  const formats = new Set();
  for (const entry of [...experience, ...projects, ...education]) {
    for (const d of [entry.startDate, entry.endDate]) {
      const f = dateFormat(d);
      if (f) formats.add(f);
    }
  }
  if (formats.size > 1) {
    add('date-format', 'low', 'Use one date format throughout', `Found mixed formats (${[...formats].join(', ')}). Pick one, e.g. "Jun 2025".`, 'Consistent formatting signals attention to detail.');
  }

  const totalWords =
    wordCount(resume.summary) +
    allBullets.reduce((n, b) => n + wordCount(b.text), 0) +
    education.reduce((n, e) => n + wordCount(e.details), 0);
  if (totalWords > 750) {
    add('too-long', 'medium', 'Your resume may run beyond one page', `About ${totalWords} words of descriptive content. Early-career resumes usually fit on one page.`, 'Concise resumes are easier to review and keep the strongest content visible.');
  }

  return items;
}
