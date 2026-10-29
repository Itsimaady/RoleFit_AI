// Shapes and helpers shared by the resume editor, preview and list.

export const TEMPLATES = [
  { id: 'classic', name: 'Classic', description: 'Serif, centred header, ruled sections' },
  { id: 'modern', name: 'Modern', description: 'Sans-serif with a blue accent' },
  { id: 'compact', name: 'Compact', description: 'Dense layout to fit one page' },
];

export const DOCX_LAYOUTS = [
  { id: 'classic', name: 'RoleFit Classic ATS' },
  { id: 'modern', name: 'RoleFit Modern' },
  { id: 'jake', name: "Jake's Resume" },
  { id: 'faangpath', name: 'FAANGPath' },
  { id: 'awesome', name: 'Awesome-CV' },
  { id: 'rendercv', name: 'RenderCV' },
  { id: 'deedy', name: 'Two-column' },
];

let tempCounter = 0;
/** Client-only key for new entries; the server assigns the real _id on save. */
export const tempKey = () => `tmp-${Date.now().toString(36)}-${(tempCounter++).toString(36)}`;

export const blank = {
  education: () => ({ institution: '', degree: '', field: '', location: '', startDate: '', endDate: '', grade: '', details: '' }),
  experience: () => ({ role: '', organization: '', location: '', type: '', startDate: '', endDate: '', current: false, bullets: [''] }),
  projects: () => ({ name: '', role: '', technologies: [], link: '', startDate: '', endDate: '', bullets: [''] }),
  certifications: () => ({ name: '', issuer: '', date: '', link: '' }),
  achievements: () => ({ title: '', description: '', date: '' }),
  links: () => ({ label: '', url: '' }),
};

/** Normalizes a server document into editor state (each entry gets a stable key). */
export function toEditorState(resume) {
  const withKeys = (items = []) => items.map((item) => ({ ...item, _key: item._id || tempKey() }));
  return {
    title: resume.title || '',
    template: resume.template || 'classic',
    personal: { fullName: '', headline: '', email: '', phone: '', location: '', website: '', linkedin: '', github: '', ...(resume.personal || {}) },
    summary: resume.summary || '',
    education: withKeys(resume.education),
    experience: withKeys(resume.experience),
    projects: withKeys(resume.projects),
    skills: { technical: resume.skills?.technical || [], interpersonal: resume.skills?.interpersonal || [] },
    certifications: withKeys(resume.certifications),
    achievements: withKeys(resume.achievements),
    links: withKeys(resume.links),
  };
}

const stripKeys = (items) => items.map(({ _key, ...rest }) => rest);
const cleanBullets = (bullets) => (bullets || []).map((b) => b.trim()).filter(Boolean);

/** Converts editor state into the API payload (drops client keys and empty bullets). */
export function toPayload(state, revision) {
  return {
    revision,
    title: state.title.trim(),
    template: state.template,
    personal: state.personal,
    summary: state.summary,
    education: stripKeys(state.education),
    experience: stripKeys(state.experience).map((e) => ({ ...e, bullets: cleanBullets(e.bullets) })),
    projects: stripKeys(state.projects).map((p) => ({ ...p, bullets: cleanBullets(p.bullets) })),
    skills: state.skills,
    certifications: stripKeys(state.certifications),
    achievements: stripKeys(state.achievements),
    links: stripKeys(state.links),
  };
}

const hasText = (v) => Boolean(String(v || '').trim());

export const SECTIONS = [
  { id: 'personal', label: 'Personal info', filled: (s) => hasText(s.personal.fullName) && hasText(s.personal.email) },
  { id: 'summary', label: 'Summary', filled: (s) => hasText(s.summary) },
  { id: 'education', label: 'Education', filled: (s) => s.education.some((e) => hasText(e.institution)) },
  { id: 'experience', label: 'Experience', filled: (s) => s.experience.some((e) => hasText(e.role) || hasText(e.organization)) },
  { id: 'projects', label: 'Projects', filled: (s) => s.projects.some((p) => hasText(p.name)) },
  { id: 'skills', label: 'Skills', filled: (s) => s.skills.technical.length > 0 },
  { id: 'certifications', label: 'Certifications', filled: (s) => s.certifications.some((c) => hasText(c.name)), optional: true },
  { id: 'achievements', label: 'Achievements', filled: (s) => s.achievements.some((a) => hasText(a.title)), optional: true },
  { id: 'links', label: 'Links', filled: (s) => s.links.some((l) => hasText(l.url)), optional: true },
];

/** Share of core (non-optional) sections with content. Purely descriptive, not a quality score. */
export function completeness(state) {
  const core = SECTIONS.filter((s) => !s.optional);
  const filled = core.filter((s) => s.filled(state)).length;
  return { filled, total: core.length, percent: Math.round((filled / core.length) * 100) };
}
