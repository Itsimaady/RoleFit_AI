// Unit tests for the pure rule-based engines (no database needed).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeResumeAgainstJob } from '../src/services/analysis.service.js';
import { reviewResumeQuality } from '../src/services/resumeQuality.js';
import { findSkills } from '../src/services/skills.js';
import { resumeToText } from '../src/services/resumeText.js';
import { importedTextToResume } from '../src/services/resumeImport.js';
import { sanitize } from '../src/services/pdf.service.js';
import { sampleResume, sampleJD } from './helpers.js';

const labels = (text) => findSkills(text).map((s) => s.label);

describe('skill detection', () => {
  it('does not confuse Java with JavaScript, or Node.js with JavaScript', () => {
    assert.deepEqual(labels('Experienced in JavaScript'), ['JavaScript']);
    assert.deepEqual(labels('Built services in Node.js'), ['Node.js']);
    assert.ok(labels('Java and Spring Boot').includes('Java'));
    assert.ok(!labels('Java and Spring Boot').includes('JavaScript'));
  });

  it('does not treat ordinary words as skills', () => {
    assert.deepEqual(labels('Take the rest of the day off and express your ideas'), []);
  });

  it('recognises aliases', () => {
    assert.ok(labels('RESTful APIs on Amazon Web Services with k8s').includes('REST APIs'));
    assert.ok(labels('RESTful APIs on Amazon Web Services with k8s').includes('AWS'));
    assert.ok(labels('RESTful APIs on Amazon Web Services with k8s').includes('Kubernetes'));
  });
});

describe('job matching', () => {
  it('computes coverage from matched / requested skills', () => {
    const r = analyzeResumeAgainstJob(sampleResume, sampleJD);
    const total = r.matchedSkills.length + r.missingSkills.length;
    assert.equal(r.scores.skillCoverage, Math.round((r.matchedSkills.length / total) * 100));
  });

  it('returns null coverage (not a fake number) when the JD has no dictionary skills', () => {
    const r = analyzeResumeAgainstJob(sampleResume, 'We want a friendly person who loves customers and can travel often across regions.');
    assert.equal(r.scores.skillCoverage, null);
  });

  it('suggests evidence for listed-only skills without telling the user to add skills they lack', () => {
    const r = analyzeResumeAgainstJob(sampleResume, sampleJD);
    const evidence = r.suggestions.find((s) => s.id === 'evidence-gap');
    assert.ok(evidence, 'Git and AWS are only in the skills list');
    const k8s = r.suggestions.find((s) => s.id === 'missing-Kubernetes');
    assert.match(k8s.detail, /If you have genuinely used Kubernetes/);
  });

  it('recommends the most relevant entry to emphasize', () => {
    const r = analyzeResumeAgainstJob(sampleResume, sampleJD);
    assert.equal(r.emphasize[0].label, 'Software Engineering Intern at TechNova');
  });
});

describe('resume quality checklist', () => {
  it('flags missing contact information and empty sections on a blank resume', () => {
    const ids = reviewResumeQuality({ title: 'x' }).map((i) => i.id);
    for (const id of ['name', 'email', 'phone', 'education', 'no-evidence', 'skills-empty']) assert.ok(ids.includes(id), id);
  });

  it('flags vague bullets, repeated openers and mixed date formats', () => {
    const items = reviewResumeQuality({
      ...sampleResume,
      experience: [
        { role: 'Intern', organization: 'A', startDate: 'Jun 2025', endDate: '08/2025', bullets: ['Worked on the website', 'Built X feature for users quickly', 'Built Y tool for staff reports', 'Built Z pipeline for nightly data'] },
      ],
    });
    const ids = items.map((i) => i.id);
    assert.ok(ids.includes('vague-bullets'));
    assert.ok(ids.includes('repeated-verbs'));
    assert.ok(ids.includes('date-format'));
    assert.ok(items.every((i) => i.why), 'every checklist item explains why it matters');
  });

  it('never suggests inventing metrics', () => {
    const q = reviewResumeQuality({ ...sampleResume, experience: [{ role: 'r', organization: 'o', bullets: ['Built a thing for the team here', 'Designed a service for the team', 'Wrote docs for the onboarding flow'] }] }).find((i) => i.id === 'quantify');
    assert.match(q.detail, /Never estimate or invent metrics/);
  });
});

describe('text conversion', () => {
  it('produces the plain-text layout the Python service expects', () => {
    const text = resumeToText(sampleResume);
    const lines = text.split('\n');
    assert.equal(lines[0], 'Aarav Sharma');
    assert.equal(lines[1], 'Software Engineer');
    assert.ok(text.includes('\nSKILLS\nTechnical: Python, FastAPI'));
    assert.ok(text.includes('- Built REST APIs with Python and FastAPI backed by PostgreSQL.'));
  });

  it('maps imported parser output into structured sections', () => {
    const r = importedTextToResume('Jane Doe\nData Analyst\njane@x.com', {
      personal: { name: 'Jane Doe', email: 'jane@x.com' },
      experience: ['Analyst Intern | Acme | Jan 2024 - Present', '- Built dashboards in Power BI', '- Cleaned data with Python'],
      projects: ['Sales Forecast', '- Forecasted sales with pandas'],
    });
    assert.equal(r.personal.headline, 'Data Analyst');
    assert.equal(r.experience[0].role, 'Analyst Intern');
    assert.equal(r.experience[0].organization, 'Acme');
    assert.equal(r.experience[0].current, true);
    assert.equal(r.experience[0].bullets.length, 2);
    assert.ok(r.projects[0].technologies.includes('Pandas'));
  });

  it('replaces characters the standard PDF fonts cannot draw', () => {
    assert.equal(sanitize('Café • नम'), 'Café • ??');
  });
});
