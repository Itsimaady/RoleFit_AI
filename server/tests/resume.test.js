import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { setupDatabase, teardownDatabase, clearDatabase, registeredClient, sampleResume, startFakeAiService, useUnreachableAiService } from './helpers.js';
import { Resume } from '../src/models/Resume.js';

let app;
before(async () => {
  app = await setupDatabase();
});
after(teardownDatabase);
beforeEach(clearDatabase);

const binary = (res, cb) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('resume CRUD', () => {
  it('creates, reads, lists and persists a resume for the owner', async () => {
    const c = await registeredClient(app);
    const created = await c.post('/api/resumes').send(sampleResume);
    assert.equal(created.status, 201);
    const id = created.body.resume._id;
    assert.equal(created.body.resume.revision, 1);
    assert.equal(created.body.resume.owner, c.user.id);

    const stored = await Resume.findById(id).lean();
    assert.equal(stored.personal.fullName, 'Aarav Sharma');
    assert.equal(stored.experience[0].bullets.length, 2);

    const read = await c.get(`/api/resumes/${id}`);
    assert.equal(read.status, 200);
    assert.equal(read.body.resume.title, 'Backend Resume');

    const list = await c.get('/api/resumes');
    assert.equal(list.status, 200);
    assert.equal(list.body.total, 1);
    assert.equal(list.body.items[0]._id, id);
  });

  it('ignores an owner field sent by the client', async () => {
    const c = await registeredClient(app);
    const other = new mongoose.Types.ObjectId().toString();
    const res = await c.post('/api/resumes').send({ ...sampleResume, owner: other });
    assert.equal(res.status, 201);
    assert.equal(res.body.resume.owner, c.user.id);
  });

  it('creates an empty resume with only a title', async () => {
    const c = await registeredClient(app);
    const res = await c.post('/api/resumes').send({ title: 'Blank' });
    assert.equal(res.status, 201);
    assert.equal(res.body.resume.template, 'classic');
    assert.deepEqual(res.body.resume.experience, []);
  });

  it('updates with optimistic concurrency and rejects stale revisions', async () => {
    const c = await registeredClient(app);
    const { body } = await c.post('/api/resumes').send(sampleResume);
    const id = body.resume._id;
    const update = { ...sampleResume, summary: 'Updated summary.', revision: 1 };

    const ok = await c.put(`/api/resumes/${id}`).send(update);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.resume.summary, 'Updated summary.');
    assert.equal(ok.body.resume.revision, 2);

    const stale = await c.put(`/api/resumes/${id}`).send({ ...update, summary: 'Stale write' });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, 'stale_revision');
    assert.equal((await Resume.findById(id).lean()).summary, 'Updated summary.');
  });

  it('validates content (email, link scheme, entry limits)', async () => {
    const c = await registeredClient(app);
    const { body } = await c.post('/api/resumes').send(sampleResume);
    const res = await c.put(`/api/resumes/${body.resume._id}`).send({
      ...sampleResume,
      revision: 1,
      personal: { ...sampleResume.personal, email: 'bad', github: 'javascript:alert(1)' },
    });
    assert.equal(res.status, 400);
    const paths = res.body.error.details.map((d) => d.path);
    assert.ok(paths.includes('personal.email'));
    assert.ok(paths.includes('personal.github'));
  });

  it('renames and changes template with PATCH', async () => {
    const c = await registeredClient(app);
    const { body } = await c.post('/api/resumes').send(sampleResume);
    const res = await c.patch(`/api/resumes/${body.resume._id}`).send({ title: 'Renamed', template: 'modern' });
    assert.equal(res.status, 200);
    assert.equal(res.body.resume.title, 'Renamed');
    assert.equal(res.body.resume.template, 'modern');
    const bad = await c.patch(`/api/resumes/${body.resume._id}`).send({ template: 'neon' });
    assert.equal(bad.status, 400);
  });

  it('duplicates a resume with fresh sub-document ids', async () => {
    const c = await registeredClient(app);
    const { body } = await c.post('/api/resumes').send(sampleResume);
    const dup = await c.post(`/api/resumes/${body.resume._id}/duplicate`);
    assert.equal(dup.status, 201);
    assert.equal(dup.body.resume.title, 'Copy of Backend Resume');
    assert.notEqual(dup.body.resume._id, body.resume._id);
    assert.notEqual(dup.body.resume.experience[0]._id, body.resume.experience[0]._id);
    assert.equal(await Resume.countDocuments({ owner: c.user.id }), 2);
  });

  it('deletes a resume', async () => {
    const c = await registeredClient(app);
    const { body } = await c.post('/api/resumes').send(sampleResume);
    const del = await c.delete(`/api/resumes/${body.resume._id}`);
    assert.equal(del.status, 204);
    assert.equal(await Resume.countDocuments(), 0);
    assert.equal((await c.get(`/api/resumes/${body.resume._id}`)).status, 404);
  });

  it('searches resumes by title and treats regex characters literally', async () => {
    const c = await registeredClient(app);
    await c.post('/api/resumes').send({ title: 'Data Analyst (2025)' });
    await c.post('/api/resumes').send({ title: 'Backend' });
    const res = await c.get('/api/resumes?q=(2025)');
    assert.equal(res.body.total, 1);
    const all = await c.get('/api/resumes?q=.*');
    assert.equal(all.body.total, 0);
  });
});

describe('resume ownership and identifiers', () => {
  it("rejects every operation on another user's resume with 404", async () => {
    const owner = await registeredClient(app);
    const intruder = await registeredClient(app);
    const { body } = await owner.post('/api/resumes').send(sampleResume);
    const id = body.resume._id;

    assert.equal((await intruder.get(`/api/resumes/${id}`)).status, 404);
    assert.equal((await intruder.put(`/api/resumes/${id}`).send({ ...sampleResume, revision: 1 })).status, 404);
    assert.equal((await intruder.patch(`/api/resumes/${id}`).send({ title: 'Hacked' })).status, 404);
    assert.equal((await intruder.delete(`/api/resumes/${id}`)).status, 404);
    assert.equal((await intruder.post(`/api/resumes/${id}/duplicate`)).status, 404);
    assert.equal((await intruder.get(`/api/resumes/${id}/export/pdf`)).status, 404);
    assert.equal((await intruder.get('/api/resumes')).body.total, 0);

    const untouched = await Resume.findById(id).lean();
    assert.equal(untouched.title, 'Backend Resume');
  });

  it('returns 400 for malformed identifiers', async () => {
    const c = await registeredClient(app);
    for (const bad of ['123', 'not-an-id', '{"$gt":""}']) {
      const res = await c.get(`/api/resumes/${encodeURIComponent(bad)}`);
      assert.equal(res.status, 400, bad);
      assert.equal(res.body.error.code, 'invalid_id');
    }
  });

  it('returns 404 for a well-formed id that does not exist', async () => {
    const c = await registeredClient(app);
    const res = await c.get(`/api/resumes/${new mongoose.Types.ObjectId()}`);
    assert.equal(res.status, 404);
  });
});

describe('resume export', () => {
  it('generates a valid PDF document with a safe filename', async () => {
    const c = await registeredClient(app);
    const { body } = await c.post('/api/resumes').send({ ...sampleResume, title: 'My "Best" Resume/2025' });
    for (const template of ['classic', 'modern', 'compact']) {
      await c.patch(`/api/resumes/${body.resume._id}`).send({ template });
      const res = await c.get(`/api/resumes/${body.resume._id}/export/pdf`).buffer(true).parse(binary);
      assert.equal(res.status, 200);
      assert.equal(res.headers['content-type'], 'application/pdf');
      assert.match(res.headers['content-disposition'], /attachment; filename="My_Best_Resume2025\.pdf"/);
      const pdf = res.body;
      assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
      assert.ok(pdf.subarray(-8).toString().includes('%%EOF'));
      assert.ok(pdf.length > 1500, `${template} PDF should contain content`);
    }
  });

  it('proxies DOCX generation to the AI service with the internal token', async () => {
    const ai = await startFakeAiService();
    try {
      const c = await registeredClient(app);
      const { body } = await c.post('/api/resumes').send(sampleResume);
      const res = await c.get(`/api/resumes/${body.resume._id}/export/docx?layout=jake`).buffer(true).parse(binary);
      assert.equal(res.status, 200);
      assert.match(res.headers['content-type'], /wordprocessingml/);
      assert.equal(res.body.subarray(0, 2).toString(), 'PK');
      const call = ai.calls.find((x) => x.path === '/api/resume/generate');
      assert.equal(call.token, 'test-internal-token');
      assert.equal(call.body.template, 'jake');
      assert.match(call.body.resume_text, /^Aarav Sharma\nSoftware Engineer/);
      assert.match(call.body.resume_text, /EXPERIENCE\nSoftware Engineering Intern \| TechNova/);
    } finally {
      await ai.stop();
    }
  });

  it('returns 503 with guidance when the AI service is down', async () => {
    const restore = await useUnreachableAiService();
    try {
      const c = await registeredClient(app);
      const { body } = await c.post('/api/resumes').send(sampleResume);
      const res = await c.get(`/api/resumes/${body.resume._id}/export/docx`);
      assert.equal(res.status, 503);
      assert.equal(res.body.error.code, 'ai_service_unavailable');
    } finally {
      restore();
    }
  });
});
