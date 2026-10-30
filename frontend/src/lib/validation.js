// Client-side validation mirrors the server rules so users get instant
// feedback. The server remains the source of truth.
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PHONE_RE = /^[+()\d\s.-]{7,40}$/;
export const LINK_RE = /^(https?:\/\/)?[\w.-]+\.[a-z]{2,}(\/\S*)?$/i;

export function passwordIssues(password) {
  const issues = [];
  if (password.length < 8) issues.push('at least 8 characters');
  if (!/[A-Za-z]/.test(password)) issues.push('a letter');
  if (!/\d/.test(password)) issues.push('a number');
  if (new TextEncoder().encode(password).length > 72) issues.push('at most 72 characters');
  return issues;
}

/** 0-4 strength estimate used only for the visual meter. */
export function passwordStrength(password) {
  if (!password) return 0;
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Za-z]/.test(password) && /\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password) || (/[a-z]/.test(password) && /[A-Z]/.test(password))) score++;
  return Math.min(4, score);
}

export function validateRegistration({ fullName, email, password, confirmPassword }) {
  const errors = {};
  if (!fullName.trim()) errors.fullName = 'Full name is required';
  else if (fullName.trim().length < 2) errors.fullName = 'Full name must be at least 2 characters';
  if (!email.trim()) errors.email = 'Email is required';
  else if (!EMAIL_RE.test(email.trim())) errors.email = 'Enter a valid email address';
  const issues = passwordIssues(password);
  if (!password) errors.password = 'Password is required';
  else if (issues.length) errors.password = `Password needs ${issues.join(', ')}`;
  if (!confirmPassword) errors.confirmPassword = 'Please confirm your password';
  else if (password !== confirmPassword) errors.confirmPassword = 'Passwords do not match';
  return errors;
}

export function validateLogin({ email, password }) {
  const errors = {};
  if (!email.trim()) errors.email = 'Email is required';
  else if (!EMAIL_RE.test(email.trim())) errors.email = 'Enter a valid email address';
  if (!password) errors.password = 'Password is required';
  return errors;
}

const link = (value) => (value && !LINK_RE.test(value.trim()) ? 'Enter a valid link, e.g. github.com/you' : null);

/** Returns { "personal.email": "message", "projects.0.link": "..." } */
export function validateResume(resume) {
  const errors = {};
  const set = (path, msg) => {
    if (msg) errors[path] = msg;
  };
  if (!resume.title?.trim()) set('title', 'Give this resume a title');
  const p = resume.personal || {};
  if (p.email && !EMAIL_RE.test(p.email.trim())) set('personal.email', 'Enter a valid email address');
  if (p.phone && !PHONE_RE.test(p.phone.trim())) set('personal.phone', 'Enter a valid phone number');
  for (const key of ['linkedin', 'github', 'website']) set(`personal.${key}`, link(p[key]));
  (resume.projects || []).forEach((pr, i) => set(`projects.${i}.link`, link(pr.link)));
  (resume.certifications || []).forEach((c, i) => set(`certifications.${i}.link`, link(c.link)));
  (resume.links || []).forEach((l, i) => set(`links.${i}.url`, link(l.url)));
  return errors;
}
