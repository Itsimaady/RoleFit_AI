import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import { connectDatabase, databaseStatus } from '../src/config/db.js';

describe('database connection and health endpoint', () => {
  it('reports disconnected (503) before a database is connected', async () => {
    const app = createApp();
    const res = await request(app).get('/api/health');
    assert.equal(res.status, 503);
    assert.equal(res.body.status, 'degraded');
    assert.equal(res.body.database.connected, false);
    assert.equal(res.body.database.state, 'disconnected');
  });

  it('returns database_unavailable (503) instead of crashing for data routes', async () => {
    const app = createApp();
    // Auth lookup needs the DB; a request with a session cookie must fail cleanly.
    mongoose.set('bufferCommands', false);
    const res = await request(app).get('/api/auth/me').set('Cookie', 'rf_session=abc');
    mongoose.set('bufferCommands', true);
    assert.equal(res.status, 503);
    assert.equal(res.body.error.code, 'database_unavailable');
    assert.ok(!JSON.stringify(res.body).includes('    at '), 'no stack trace in response');
  });

  it('refuses to start without a connection string', async () => {
    await assert.rejects(connectDatabase(''), /MONGODB_URI is not set/);
  });

  it('fails clearly when the server is unreachable', async () => {
    await assert.rejects(
      mongoose.connect('mongodb://127.0.0.1:1/rolefit', { serverSelectionTimeoutMS: 500 }),
      (err) => err.name === 'MongooseServerSelectionError',
    );
    await mongoose.disconnect();
  });

  it('reports connected (200) once MongoDB is reachable, and disconnected after', async () => {
    const mongod = await MongoMemoryServer.create();
    try {
      await connectDatabase(mongod.getUri('rolefit-health'));
      const app = createApp();
      const res = await request(app).get('/api/health');
      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'ok');
      assert.equal(res.body.database.connected, true);
      assert.equal(res.body.database.name, 'rolefit-health');
      await mongoose.disconnect();
      assert.equal(databaseStatus().connected, false);
    } finally {
      await mongod.stop();
    }
  });
});
