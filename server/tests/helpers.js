import http from 'node:http';
import { WebSocketServer } from 'ws';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createApp } from '../src/app.js';
import { connectDatabase } from '../src/config/db.js';
import { config } from '../src/config/env.js';

export const ORIGIN = 'http://localhost:5173';
let mongod;

/** Isolated, throwaway MongoDB for each test file. Never touches real data. */
export async function setupDatabase() {
  mongod = await MongoMemoryServer.create();
  await connectDatabase(mongod.getUri('rolefit-test'));
  return createApp();
}

export async function teardownDatabase() {
  await mongoose.disconnect();
  await mongod?.stop();
}

export async function clearDatabase() {
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
}

/** A cookie-keeping client that fetches a CSRF token first, like the SPA does. */
export async function client(app) {
  const agent = request.agent(app);
  const res = await agent.get('/api/auth/csrf');
  const csrf = res.body.csrfToken;
  const wrap = (method) => (url) => agent[method](url).set('X-CSRF-Token', csrf).set('Origin', ORIGIN);
  return { agent, csrf, get: (url) => agent.get(url), post: wrap('post'), put: wrap('put'), patch: wrap('patch'), delete: wrap('delete') };
}

export const strongPassword = 'Passw0rd!23';

export async function registeredClient(app, email = `user${Math.random().toString(36).slice(2, 8)}@example.com`) {
  const c = await client(app);
  const res = await c.post('/api/auth/register').send({ fullName: 'Test Student', email, password: strongPassword, confirmPassword: strongPassword });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  const cookie = res.headers['set-cookie'].find((h) => h.startsWith('rf_session=')).split(';')[0];
  return { ...c, user: res.body.user, email, cookie };
}

export const sampleResume = {
  title: 'Backend Resume',
  template: 'classic',
  personal: { fullName: 'Aarav Sharma', headline: 'Software Engineer', email: 'aarav@example.com', phone: '+91 98765 43210', location: 'Hyderabad, India', github: 'github.com/aarav' },
  summary: 'Computer science student building backend services and web applications.',
  education: [{ institution: 'JNTU Hyderabad', degree: 'B.Tech', field: 'Computer Science', startDate: '2022', endDate: '2026' }],
  experience: [
    {
      role: 'Software Engineering Intern',
      organization: 'TechNova',
      startDate: 'Jun 2025',
      endDate: 'Aug 2025',
      bullets: ['Built REST APIs with Python and FastAPI backed by PostgreSQL.', 'Containerized two services with Docker for consistent local development.'],
    },
  ],
  projects: [{ name: 'Weather Intelligence Platform', technologies: ['React', 'Node.js'], bullets: ['Developed a React dashboard consuming a Node.js API with cached forecasts.'] }],
  skills: { technical: ['Python', 'FastAPI', 'React', 'Node.js', 'PostgreSQL', 'Docker', 'Git', 'AWS'], interpersonal: ['Communication'] },
};

export const sampleJD = `Backend Software Engineer

Required Qualifications
- Strong proficiency in Python and FastAPI.
- Experience building REST APIs with PostgreSQL.
- Hands-on experience with Docker and Kubernetes.
- Familiarity with CI/CD pipelines and Git.

Preferred
- Experience with Redis or Kafka.`;

/** Minimal stand-in for the Python AI service, recording what Express sends it. */
export async function startFakeAiService({ geminiConfigured = true, ...options } = {}) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      calls.push({ path: req.url, token: req.headers['x-internal-token'], body: body ? safeJson(body) : null });
      const json = (status, data) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      };
      if (req.url === '/api/health') return json(200, { status: 'ok', gemini_live_configured: geminiConfigured, version: 'fake' });
      if (req.headers['x-internal-token'] !== process.env.AI_SERVICE_TOKEN) return json(401, { detail: 'bad token' });
      if (req.url === '/api/interview/start') {
        return json(200, { ai_used: true, questions: Array.from({ length: 12 }, (_, i) => ({ round: 'Technical', difficulty: 'Medium', question: `Question ${i + 1}?` })) });
      }
      if (req.url === '/api/interview/evaluate') return json(200, { score: 72, feedback: 'Relevant answer.', improvement: 'Add an example.', presentation: { Communication: 70 }, ai_used: true });
      if (req.url === '/api/interview/final') return json(200, { overall_score: 70, summary: 'Solid.', strengths: ['Clear'], improvements: ['Depth'], ai_used: true });
      if (req.url === '/api/resume/generate') {
        res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
        return res.end(Buffer.from('PK\u0003\u0004fake-docx'));
      }
      if (req.url === '/api/ai/rewrite-bullet') return json(200, { suggestion: 'Built REST APIs in FastAPI.', notes: '' });
      // ---- guided interview stand-ins
      const b = calls.at(-1).body || {};
      if (req.url === '/api/interview/guided/questions') {
        return json(200, { questions: Array.from({ length: b.count }, (_, i) => ({ question: `${b.category} question ${i + 1}?`, category: b.category, topic: 't', difficulty: b.difficulty })) });
      }
      if (req.url === '/api/interview/guided/evaluate') {
        if (options.failEvaluate) return json(502, { detail: 'The AI could not produce a valid answer evaluation. Please try again.' });
        // Deterministic score derived from the transcript so tests can check averages.
        const score = Number((b.transcript.match(/score=(\d+)/) || [])[1] ?? 7);
        return json(200, { score, strengths: ['Clear'], missing_concepts: ['Edge cases'], inaccuracies: [], clarity: 'Good.', improvements: ['Add an example'], example_answer: 'A strong answer would…', revise: ['Big-O'], follow_up: 'Why?' });
      }
      if (req.url === '/api/interview/guided/learn') {
        if (options.failLearn) return json(502, { detail: 'The AI could not produce a valid learning answer. Please try again.' });
        return json(200, { why_it_matters: 'It matters.', concepts: ['Hashing'], example_answer: 'Suggested answer: …', simple_explanation: 'Simply put…', practical_example: 'For example…', key_points: ['Point'], follow_up_question: 'Next?' });
      }
      if (req.url === '/api/interview/guided/summary') return json(200, { strengths: ['Clear explanations'], improvements: ['Depth'], recommendations: ['Revise hashing'], ai_used: true });
      return json(404, { detail: 'not found' });
    });
  });
  // Stand-in for the Gemini Live bridge at /ws/monk-live.
  const live = { upgrades: [], messages: [] };
  const wss = new WebSocketServer({ server, path: '/ws/monk-live' });
  wss.on('connection', (ws, req) => {
    live.upgrades.push({ token: req.headers['x-internal-token'] });
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      live.messages.push(msg);
      if (msg.type === 'start') ws.send(JSON.stringify({ type: 'ready', model: 'fake-live' }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const previous = config.aiService.url;
  config.aiService.url = `http://127.0.0.1:${server.address().port}`;
  return {
    calls,
    live,
    async stop() {
      config.aiService.url = previous;
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      await new Promise((r) => server.close(r));
    },
  };
}

/** Points the API at a port with nothing listening, regardless of what runs locally. */
export async function useUnreachableAiService() {
  const probe = http.createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const { port } = probe.address();
  await new Promise((r) => probe.close(r));
  const previous = config.aiService.url;
  config.aiService.url = `http://127.0.0.1:${port}`;
  return () => {
    config.aiService.url = previous;
  };
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
