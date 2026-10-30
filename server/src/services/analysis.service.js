// Transparent, rule-based resume <-> job description comparison.
// Deterministic: the same resume and job description always produce the same output.
import { SKILLS, normalizeText } from './skills.js';
import { reviewResumeQuality } from './resumeQuality.js';

export const ANALYSIS_METHOD = {
  name: 'rule-based-skill-and-keyword-match',
  version: '1.0.0',
  description:
    'Skills from a curated dictionary (~110 skills with aliases) are detected in the job description and searched for in each ' +
    'resume section. Skill coverage = matched skills / skills the job description mentions. Keyword coverage = share of the ' +
    'job description’s 20 most frequent non-skill terms that also appear in the resume. These are coverage measures, ' +
    'not an ATS score and not a prediction of hiring outcomes.',
};

const STOP_WORDS = new Set(
  `a about above across after again against all also an and any are as at be because been before being below between both but by
  can could did do does doing during each either etc even ever every few for from further get gets given good great had has have
  having help helps here how however if in including into is it its itself just like make makes many may more most much must
  need needs new no nor not now of off on once one only or other our out over own per plus same should since so some such than
  that the their them then there these they this those through to too under until up upon us use used using very via want was
  we well were what when where which while who whom why will with within without would you your yours
  ability able apply applicant applicants candidate candidates company team teams role roles job jobs position opportunity
  work working works experience experienced years year strong excellent proficiency proficient knowledge understanding
  familiarity familiar hands-on looking seeking join responsible responsibilities requirements required requirement
  qualification qualifications preferred bonus nice skills skill etc environment day based level including include
  related relevant degree bachelor bachelors master masters equivalent field minimum least such across ensure`.split(/\s+/),
);

const PREFERRED_MARKERS = /\b(preferred|nice[- ]to[- ]have|bonus|good to have|a plus|desirable|optional)\b/i;
const REQUIRED_MARKERS = /\b(required|requirements|must|qualifications|responsibilities|what you.?ll do|you have|essential)\b/i;

function stem(word) {
  if (word.length > 6 && word.endsWith('ing')) return word.slice(0, -3);
  if (word.length > 5 && word.endsWith('ed')) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith('es')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

function tokenize(text) {
  return (normalizeText(text).match(/[a-z][a-z0-9+#-]{2,}/g) || []).map((t) => t.replace(/-+$/, ''));
}

/** Classify each JD skill as required or preferred based on the line/section it appears in. */
function skillPriorities(jobDescription, skills) {
  const priorities = new Map();
  let mode = 'required';
  for (const rawLine of jobDescription.split(/\r?\n/)) {
    const line = normalizeText(rawLine);
    if (!line.trim()) continue;
    const isHeading = line.trim().length < 60 && !/[.]$/.test(line.trim());
    let lineMode = mode;
    if (PREFERRED_MARKERS.test(line)) lineMode = 'preferred';
    else if (REQUIRED_MARKERS.test(line)) lineMode = 'required';
    if (isHeading && lineMode !== mode) mode = lineMode;
    for (const skill of skills) {
      if (!skill.regex.test(line)) continue;
      // A skill mentioned anywhere as required stays required.
      if (lineMode === 'required' || !priorities.has(skill.label)) priorities.set(skill.label, lineMode);
    }
  }
  return priorities;
}

/** Splits a structured resume into labelled text chunks so matches can cite evidence. */
function resumeChunks(resume) {
  const chunks = [];
  const add = (section, label, text) => {
    if (text && text.trim()) chunks.push({ section, label, text });
  };
  const p = resume.personal || {};
  add('Headline', p.headline || 'Headline', p.headline);
  add('Summary', 'Professional summary', resume.summary);
  add('Skills', 'Technical skills', (resume.skills?.technical || []).join(', '));
  add('Skills', 'Interpersonal skills', (resume.skills?.interpersonal || []).join(', '));
  for (const e of resume.experience || []) {
    add('Experience', [e.role, e.organization].filter(Boolean).join(' at ') || 'Experience entry', [e.role, e.organization, ...(e.bullets || [])].join('\n'));
  }
  for (const pr of resume.projects || []) {
    add('Projects', pr.name || 'Project', [pr.name, pr.role, (pr.technologies || []).join(', '), ...(pr.bullets || [])].join('\n'));
  }
  for (const ed of resume.education || []) {
    add('Education', ed.institution || ed.degree || 'Education entry', [ed.degree, ed.field, ed.institution, ed.details].join('\n'));
  }
  for (const c of resume.certifications || []) add('Certifications', c.name || 'Certification', [c.name, c.issuer].join(' '));
  for (const a of resume.achievements || []) add('Achievements', a.title || 'Achievement', [a.title, a.description].join(' '));
  return chunks.map((c) => ({ ...c, normalized: normalizeText(c.text) }));
}

function extractKeywords(jobDescription, jdSkills, limit = 20) {
  const counts = new Map();
  const firstSeen = new Map();
  tokenize(jobDescription).forEach((token, i) => {
    if (STOP_WORDS.has(token) || token.length < 4 || /^\d/.test(token)) return;
    // Skip terms already covered by the skill dictionary.
    if (jdSkills.some((s) => s.regex.test(token))) return;
    const key = stem(token);
    counts.set(key, (counts.get(key) || 0) + 1);
    if (!firstSeen.has(key)) firstSeen.set(key, { index: i, display: token });
  });
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || firstSeen.get(a[0]).index - firstSeen.get(b[0]).index)
    .slice(0, limit)
    .map(([key]) => ({ key, display: firstSeen.get(key).display }));
}

const pct = (part, whole) => (whole ? Math.round((part / whole) * 100) : null);

export function analyzeResumeAgainstJob(resume, jobDescription, targetRole = '') {
  const jdText = `${targetRole}\n${jobDescription}`;
  const jdNormalized = normalizeText(jdText);
  const jdSkills = SKILLS.filter((s) => s.regex.test(jdNormalized));
  const priorities = skillPriorities(jdText, jdSkills);
  const chunks = resumeChunks(resume);

  const evidence = [];
  const matched = [];
  const missing = [];
  for (const skill of jdSkills) {
    const sources = chunks.filter((c) => skill.regex.test(c.normalized)).map((c) => ({ section: c.section, label: c.label }));
    if (sources.length) {
      matched.push(skill);
      evidence.push({ skill: skill.label, sources });
    } else {
      missing.push(skill);
    }
  }

  // Resume skills not requested by this job: still worth knowing about.
  const allResumeText = chunks.map((c) => c.normalized).join('\n');
  const relevantSkills = SKILLS.filter((s) => s.regex.test(allResumeText)).map((s) => s.label);

  const keywords = extractKeywords(jdText, jdSkills);
  const resumeStems = new Set(tokenize(allResumeText).map(stem));
  const matchedKeywords = keywords.filter((k) => resumeStems.has(k.key)).map((k) => k.display);
  const missingKeywords = keywords.filter((k) => !resumeStems.has(k.key)).map((k) => k.display);

  // Experience/projects to emphasize: entries that demonstrate the most job skills.
  const emphasize = chunks
    .filter((c) => c.section === 'Experience' || c.section === 'Projects')
    .map((c) => ({ section: c.section, label: c.label, matchedSkills: matched.filter((s) => s.regex.test(c.normalized)).map((s) => s.label) }))
    .filter((c) => c.matchedSkills.length)
    .sort((a, b) => b.matchedSkills.length - a.matchedSkills.length)
    .slice(0, 5);

  const suggestions = [];
  const requiredMissing = missing.filter((s) => priorities.get(s.label) !== 'preferred');
  const preferredMissing = missing.filter((s) => priorities.get(s.label) === 'preferred');
  for (const skill of requiredMissing.slice(0, 8)) {
    suggestions.push({
      id: `missing-${skill.label}`,
      category: 'Missing skill',
      severity: 'high',
      title: `${skill.label} is requested but not found in your resume`,
      detail: `If you have genuinely used ${skill.label}, add it to your skills and describe where you used it in a project or experience bullet. If you have not, consider learning it — do not list it otherwise.`,
      why: 'Recruiters and screening tools look for the job’s required skills; listing only skills you can discuss keeps the interview honest.',
    });
  }
  if (preferredMissing.length) {
    suggestions.push({
      id: 'missing-preferred',
      category: 'Preferred skill',
      severity: 'low',
      title: `Preferred skills not found: ${preferredMissing.map((s) => s.label).join(', ')}`,
      detail: 'These are listed as preferred or nice-to-have. Mention them only where you have real exposure, such as coursework or a project.',
      why: 'Preferred skills can differentiate you but are rarely mandatory for early-career roles.',
    });
  }
  const skillsOnly = evidence.filter((e) => e.sources.every((s) => s.section === 'Skills'));
  if (skillsOnly.length) {
    suggestions.push({
      id: 'evidence-gap',
      category: 'Evidence',
      severity: 'medium',
      title: `Back up skills with evidence: ${skillsOnly.slice(0, 6).map((e) => e.skill).join(', ')}`,
      detail: 'These skills appear only in your skills list. Add a project or experience bullet that shows how you used each one.',
      why: 'A skill shown in context (what you built, with which tool, and the result) is far more convincing than a list entry.',
    });
  }
  if (emphasize.length) {
    suggestions.push({
      id: 'emphasize',
      category: 'Emphasis',
      severity: 'low',
      title: `Lead with "${emphasize[0].label}"`,
      detail: `It demonstrates ${emphasize[0].matchedSkills.join(', ')} — the strongest overlap with this job. Consider ordering it first within its section.`,
      why: 'Reviewers skim; the most relevant evidence should be the easiest to find.',
    });
  }
  if (missingKeywords.length) {
    suggestions.push({
      id: 'keywords',
      category: 'Wording',
      severity: 'low',
      title: 'Job description terms you could mirror where accurate',
      detail: `Terms not found in your resume: ${missingKeywords.slice(0, 10).join(', ')}. Use the employer’s wording only to describe work you actually did.`,
      why: 'Using the same vocabulary as the posting makes your relevant experience easier to recognise.',
    });
  }

  return {
    scores: {
      skillCoverage: pct(matched.length, jdSkills.length),
      keywordCoverage: pct(matchedKeywords.length, keywords.length),
    },
    matchedSkills: matched.map((s) => s.label),
    missingSkills: missing.map((s) => s.label),
    missingSkillPriorities: missing.map((s) => ({ skill: s.label, priority: priorities.get(s.label) || 'required' })),
    matchedKeywords,
    missingKeywords,
    relevantSkills,
    evidence,
    emphasize,
    suggestions,
    checklist: reviewResumeQuality(resume),
    method: ANALYSIS_METHOD,
  };
}
