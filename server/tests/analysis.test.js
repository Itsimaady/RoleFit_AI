import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDatabase, teardownDatabase, clearDatabase, registeredClient, sampleResume, sampleJD } from './helpers.js';
import { JobAnalysis } from '../src/models/JobAnalysis.js';

let app;
before(async () => {
  app = await setupDatabase();
});
after(teardownDatabase);
beforeEach(clearDatabase);

async function withResume() {
  const c = await registeredClient(app);
  const { body } = await c.post('/api/resumes').send(sampleResume);
  return { c, resumeId: body.resume._id };
}

describe('job analysis API', () => {
  it('produces an explainable analysis and persists it', async () => {
    const { c, resumeId } = await withResume();
    const res = await c.post('/api/analyses').send({ resumeId, jobDescription: sampleJD, targetRole: 'Backend Engineer' });
    assert.equal(res.status, 201);
    const a = res.body.analysis;

    assert.ok(a.matchedSkills.includes('Python'));
    assert.ok(a.matchedSkills.includes('FastAPI'));
    assert.ok(a.matchedSkills.includes('Docker'));
    assert.ok(a.missingSkills.includes('Kubernetes'));
    assert.ok(a.missingSkills.includes('CI/CD'));
    // Redis/Kafka are listed under "Preferred".
    assert.deepEqual(a.missingSkillPriorities.find((p) => p.skill === 'Redis'), { skill: 'Redis', priority: 'preferred' });
    assert.equal(a.missingSkillPriorities.find((p) => p.skill === 'Kubernetes').priority, 'required');

    assert.ok(a.scores.skillCoverage > 0 && a.scores.skillCoverage < 100);
    assert.equal(a.method.version, '1.0.0');
    assert.match(a.method.description, /not an ATS score/);
    // Evidence cites the resume section where the skill was found.
    const docker = a.evidence.find((e) => e.skill === 'Docker');
    assert.ok(docker.sources.some((s) => s.section === 'Experience'));
    assert.equal(a.resumeSnapshot.title, 'Backend Resume');

    const stored = await JobAnalysis.findById(a._id).lean();
    assert.equal(stored.owner.toString(), c.user.id);
    assert.deepEqual(stored.matchedSkills, a.matchedSkills);

    const list = await c.get('/api/analyses');
    assert.equal(list.body.total, 1);
    const one = await c.get(`/api/analyses/${a._id}`);
    assert.equal(one.status, 200);
    assert.equal(one.body.analysis.jobDescription, sampleJD);
  });

  it('is deterministic for the same input', async () => {
    const { c, resumeId } = await withResume();
    const a = (await c.post('/api/analyses').send({ resumeId, jobDescription: sampleJD })).body.analysis;
    const b = (await c.post('/api/analyses').send({ resumeId, jobDescription: sampleJD })).body.analysis;
    assert.deepEqual(a.scores, b.scores);
    assert.deepEqual(a.matchedSkills, b.matchedSkills);
    assert.deepEqual(a.missingKeywords, b.missingKeywords);
  });

  it('rejects missing required fields', async () => {
    const { c, resumeId } = await withResume();
    const noJd = await c.post('/api/analyses').send({ resumeId });
    assert.equal(noJd.status, 400);
    assert.ok(noJd.body.error.details.some((d) => d.path === 'jobDescription'));
    const noResume = await c.post('/api/analyses').send({ jobDescription: sampleJD });
    assert.equal(noResume.status, 400);
  });

  it('rejects too-short and oversized job descriptions', async () => {
    const { c, resumeId } = await withResume();
    const short = await c.post('/api/analyses').send({ resumeId, jobDescription: 'Python dev' });
    assert.equal(short.status, 400);
    const huge = await c.post('/api/analyses').send({ resumeId, jobDescription: 'python '.repeat(4000) });
    assert.equal(huge.status, 400);
    assert.match(huge.body.error.details[0].message, /at most 20,000/);
    assert.equal(await JobAnalysis.countDocuments(), 0);
  });

  it('rejects request bodies above the size limit', async () => {
    const { c, resumeId } = await withResume();
    const res = await c.post('/api/analyses').send({ resumeId, jobDescription: 'x'.repeat(300 * 1024) });
    assert.equal(res.status, 413);
  });

  it("cannot analyze or read another user's data", async () => {
    const { c, resumeId } = await withResume();
    const intruder = await registeredClient(app);
    const attempt = await intruder.post('/api/analyses').send({ resumeId, jobDescription: sampleJD });
    assert.equal(attempt.status, 404);

    const mine = (await c.post('/api/analyses').send({ resumeId, jobDescription: sampleJD })).body.analysis;
    assert.equal((await intruder.get(`/api/analyses/${mine._id}`)).status, 404);
    assert.equal((await intruder.delete(`/api/analyses/${mine._id}`)).status, 404);
    assert.equal((await intruder.get('/api/analyses')).body.total, 0);
  });

  it('keeps analysis history after the resume is deleted', async () => {
    const { c, resumeId } = await withResume();
    const a = (await c.post('/api/analyses').send({ resumeId, jobDescription: sampleJD })).body.analysis;
    await c.delete(`/api/resumes/${resumeId}`);
    const res = await c.get(`/api/analyses/${a._id}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.analysis.resumeSnapshot.title, 'Backend Resume');
  });
});
