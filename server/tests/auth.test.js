import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import request from 'supertest';
import { setupDatabase, teardownDatabase, clearDatabase, client, registeredClient, strongPassword, ORIGIN } from './helpers.js';
import { User } from '../src/models/User.js';
import { Session } from '../src/models/Session.js';

let app;
before(async () => {
  app = await setupDatabase();
});
after(teardownDatabase);
beforeEach(clearDatabase);

const valid = { fullName: 'Priya Rao', email: 'Priya.Rao@Example.com', password: strongPassword, confirmPassword: strongPassword };

describe('registration', () => {
  it('creates a user with a bcrypt hash, normalized email and an HttpOnly session cookie', async () => {
    const c = await client(app);
    const res = await c.post('/api/auth/register').send(valid);
    assert.equal(res.status, 201);
    assert.equal(res.body.user.email, 'priya.rao@example.com');
    assert.equal(res.body.user.passwordHash, undefined);
    assert.ok(!JSON.stringify(res.body).includes(strongPassword));

    const cookie = res.headers['set-cookie'].find((h) => h.startsWith('rf_session='));
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);

    const stored = await User.findOne({ email: 'priya.rao@example.com' }).select('+passwordHash').lean();
    assert.ok(stored.passwordHash.startsWith('$2'), 'password is stored as a bcrypt hash');
    assert.notEqual(stored.passwordHash, strongPassword);

    // The session token is stored hashed, never raw.
    const raw = cookie.split(';')[0].split('=')[1];
    const sessions = await Session.find().lean();
    assert.equal(sessions.length, 1);
    assert.notEqual(sessions[0].tokenHash, raw);
  });

  it('rejects invalid input with field-level messages', async () => {
    const c = await client(app);
    const res = await c.post('/api/auth/register').send({ fullName: 'A', email: 'not-an-email', password: 'short', confirmPassword: 'different' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'validation_error');
    const paths = res.body.error.details.map((d) => d.path);
    for (const field of ['fullName', 'email', 'password']) assert.ok(paths.includes(field), `expected error for ${field}`);
    assert.equal(await User.countDocuments(), 0);
  });

  it('rejects mismatched password confirmation', async () => {
    const c = await client(app);
    const res = await c.post('/api/auth/register').send({ ...valid, confirmPassword: 'Different123' });
    assert.equal(res.status, 400);
    assert.ok(res.body.error.details.some((d) => d.path === 'confirmPassword'));
  });

  it('rejects weak passwords without a digit', async () => {
    const c = await client(app);
    const res = await c.post('/api/auth/register').send({ ...valid, password: 'onlyletters', confirmPassword: 'onlyletters' });
    assert.equal(res.status, 400);
  });

  it('returns 409 for a duplicate email regardless of case', async () => {
    await registeredClient(app, 'dup@example.com');
    const c = await client(app);
    const res = await c.post('/api/auth/register').send({ ...valid, email: 'DUP@example.com' });
    assert.equal(res.status, 409);
    assert.equal(await User.countDocuments({ email: 'dup@example.com' }), 1);
  });

  it('ignores mass-assigned fields such as passwordHash or _id', async () => {
    const c = await client(app);
    const forcedId = new mongoose.Types.ObjectId().toString();
    const res = await c.post('/api/auth/register').send({ ...valid, _id: forcedId, passwordHash: 'x', role: 'admin' });
    assert.equal(res.status, 201);
    assert.notEqual(res.body.user.id, forcedId);
    const stored = await User.findById(res.body.user.id).select('+passwordHash').lean();
    assert.ok(stored.passwordHash.startsWith('$2'));
    assert.equal(stored.role, undefined);
  });
});

describe('login and logout', () => {
  it('logs in with correct credentials and reads the profile', async () => {
    await registeredClient(app, 'login@example.com');
    const c = await client(app);
    const res = await c.post('/api/auth/login').send({ email: 'LOGIN@example.com', password: strongPassword });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.email, 'login@example.com');
    const me = await c.get('/api/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.user.email, 'login@example.com');
    assert.ok(me.body.sessionExpiresAt);
  });

  it('rejects a wrong password and an unknown email with the same message', async () => {
    await registeredClient(app, 'login2@example.com');
    const c = await client(app);
    const wrong = await c.post('/api/auth/login').send({ email: 'login2@example.com', password: 'Wrong12345' });
    const unknown = await c.post('/api/auth/login').send({ email: 'nobody@example.com', password: 'Wrong12345' });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrong.body.error.message, unknown.body.error.message);
  });

  it('rejects NoSQL operator injection in the login body', async () => {
    await registeredClient(app, 'inject@example.com');
    const c = await client(app);
    const res = await c.post('/api/auth/login').send({ email: { $gt: '' }, password: { $gt: '' } });
    assert.equal(res.status, 400);
  });

  it('logout destroys the server-side session', async () => {
    const c = await registeredClient(app, 'logout@example.com');
    assert.equal((await c.get('/api/auth/me')).status, 200);
    assert.equal((await c.post('/api/auth/logout')).status, 200);
    assert.equal(await Session.countDocuments(), 0);
    assert.equal((await c.get('/api/auth/me')).status, 401);
  });

  it('treats an expired session as signed out', async () => {
    const c = await registeredClient(app, 'expired@example.com');
    await Session.updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await c.get('/api/auth/me');
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'session_expired');
  });
});

describe('protection', () => {
  it('rejects protected routes without authentication', async () => {
    for (const url of ['/api/auth/me', '/api/resumes', '/api/analyses', '/api/interviews', '/api/dashboard']) {
      const res = await request(app).get(url);
      assert.equal(res.status, 401, url);
    }
  });

  it('rejects state-changing requests without a CSRF token', async () => {
    const res = await request(app).post('/api/auth/register').set('Origin', ORIGIN).send(valid);
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'csrf_failed');
  });

  it('rejects requests from an origin that is not allow-listed', async () => {
    const c = await client(app);
    const res = await c.agent.post('/api/auth/login').set('X-CSRF-Token', c.csrf).set('Origin', 'https://evil.example').send({ email: 'a@b.co', password: 'x' });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'origin_rejected');
  });

  it('sets security headers and does not reveal Express', async () => {
    const res = await request(app).get('/api/health');
    assert.equal(res.headers['x-powered-by'], undefined);
    assert.ok(res.headers['content-security-policy']);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
  });
});

describe('profile', () => {
  it('updates only allowed profile fields', async () => {
    const c = await registeredClient(app, 'profile@example.com');
    const res = await c.patch('/api/auth/me').send({ fullName: 'New Name', email: 'hijack@example.com', profile: { targetRole: 'Backend Engineer' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.fullName, 'New Name');
    assert.equal(res.body.user.email, 'profile@example.com');
    assert.equal(res.body.user.profile.targetRole, 'Backend Engineer');
  });
});
