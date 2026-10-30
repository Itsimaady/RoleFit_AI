// Maps the Python parser's line-based output onto the structured Resume model.
// Heuristic by nature: the UI asks the user to review every imported section.
import { findSkills } from './skills.js';

const clip = (value, max) => String(value || '').trim().slice(0, max);
const BULLET = /^[•●▪*\-–]\s*/;

/** Groups lines into { header, bullets } blocks: bullet lines attach to the previous header. */
function groupLines(lines = []) {
  const groups = [];
  for (const raw of lines) {
    const line = String(raw || '').trim();
    if (!line) continue;
    if (BULLET.test(line) && groups.length) {
      groups.at(-1).bullets.push(line.replace(BULLET, ''));
    } else if (groups.length && !BULLET.test(line) && groups.at(-1).bullets.length === 0 && line.length > 60) {
      // Long prose directly under a header reads as a description bullet.
      groups.at(-1).bullets.push(line);
    } else {
      groups.push({ header: line.replace(BULLET, ''), bullets: [] });
    }
  }
  return groups;
}

const splitHeader = (header) => header.split(/\s+(?:\||—|–| - | at )\s+/).map((x) => x.trim()).filter(Boolean);
const DATE_RANGE = /((?:[A-Za-z]{3,9}\.?\s+)?\d{4})\s*(?:-|to|–)\s*((?:[A-Za-z]{3,9}\.?\s+)?\d{4}|present|current)/i;

function dates(text) {
  const m = String(text).match(DATE_RANGE);
  return m ? { startDate: clip(m[1], 30), endDate: /present|current/i.test(m[2]) ? '' : clip(m[2], 30), current: /present|current/i.test(m[2]) } : {};
}

export function importedTextToResume(text, structured = {}) {
  const personal = structured.personal || {};
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const headline = lines[1] && !/@|\d{5,}/.test(lines[1]) && lines[1].length < 80 ? lines[1] : '';

  const experience = groupLines(structured.experience).slice(0, 15).map((g) => {
    const parts = splitHeader(g.header);
    const d = dates(g.header);
    return {
      role: clip(parts[0], 120),
      organization: clip(parts[1] && !DATE_RANGE.test(parts[1]) ? parts[1] : '', 150),
      startDate: d.startDate || '',
      endDate: d.endDate || '',
      current: Boolean(d.current),
      bullets: g.bullets.slice(0, 12).map((b) => clip(b, 400)),
    };
  });

  const projects = groupLines(structured.projects).slice(0, 15).map((g) => ({
    name: clip(splitHeader(g.header)[0], 150),
    technologies: findSkills(g.header + ' ' + g.bullets.join(' ')).map((s) => s.label).slice(0, 25),
    bullets: g.bullets.slice(0, 10).map((b) => clip(b, 400)),
  }));

  const education = groupLines(structured.education).slice(0, 10).map((g) => {
    const d = dates(g.header);
    return {
      institution: clip(splitHeader(g.header)[0], 150),
      details: clip([...splitHeader(g.header).slice(1).filter((p) => !DATE_RANGE.test(p)), ...g.bullets].join('; '), 500),
      startDate: d.startDate || '',
      endDate: d.endDate || '',
    };
  });

  const all = findSkills(text).map((s) => s);
  return {
    title: clip(`Imported - ${personal.name || 'resume'}`, 100),
    template: 'classic',
    personal: {
      fullName: clip(personal.name, 80),
      headline: clip(headline, 120),
      email: clip(personal.email, 254),
      phone: clip(personal.phone, 40),
      location: clip(personal.location, 120),
      linkedin: clip(personal.linkedin, 300),
      github: clip(personal.github, 300),
    },
    summary: clip(structured.summary, 1500),
    experience,
    projects,
    education,
    skills: {
      technical: all.filter((s) => s.category !== 'interpersonal').map((s) => s.label).slice(0, 60),
      interpersonal: all.filter((s) => s.category === 'interpersonal').map((s) => s.label).slice(0, 30),
    },
    certifications: (structured.certifications || []).slice(0, 20).map((c) => ({ name: clip(String(c).replace(BULLET, ''), 150) })),
  };
}
