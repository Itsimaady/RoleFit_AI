// Authenticated WebSocket relay: browser <-> Express <-> Python AI service <-> Gemini Live.
// The browser never talks to the AI service directly and never sees the Gemini key.
// Express authenticates the session cookie, checks the Origin (CSWSH protection),
// verifies interview ownership, and sends the interview context itself so the
// client cannot tamper with the resume, job description or questions.
import { WebSocketServer, WebSocket } from 'ws';
import { config } from '../config/env.js';
import { findActiveSession } from './session.service.js';
import { InterviewSession } from '../models/InterviewSession.js';

export const LIVE_PATH = '/ws/interview-live';
const MAX_AUDIO_B64 = 512 * 1024;

function parseCookies(header = '') {
  return Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim().split('='))
      .filter(([k, v]) => k && v !== undefined)
      .map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]),
  );
}

function reject(socket, status, message) {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

const send = (ws, obj) => {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
};

function upstreamUrl() {
  const url = new URL(config.aiService.url);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/ws/monk-live';
  return url.toString();
}

function relay(client, interview) {
  const questions = interview.questions;
  const upstream = new WebSocket(upstreamUrl(), {
    headers: config.aiService.token ? { 'X-Internal-Token': config.aiService.token } : {},
    handshakeTimeout: 10000,
    maxPayload: 8 * 1024 * 1024,
  });
  let closed = false;

  const shutdown = (reason) => {
    if (closed) return;
    closed = true;
    if (reason) send(client, { type: 'error', message: reason });
    try {
      if (upstream.readyState === WebSocket.OPEN) upstream.send(JSON.stringify({ type: 'close' }));
      upstream.close();
    } catch {
      /* already closed */
    }
    try {
      client.close();
    } catch {
      /* already closed */
    }
  };

  const toUpstream = (obj) => {
    if (upstream.readyState === WebSocket.OPEN) upstream.send(JSON.stringify(obj));
  };

  upstream.on('open', () => {
    toUpstream({
      type: 'start',
      resume_text: interview.resumeText,
      job_description: `Target role: ${interview.targetRole}\n\n${interview.jobDescription}`,
      questions,
      // After a dropped connection, resume at the first unanswered question.
      start_index: Math.min(interview.answers?.length || 0, questions.length - 1),
    });
    send(client, { type: 'relay_connected' });
    InterviewSession.updateOne({ _id: interview._id, status: 'ready' }, { $set: { status: 'in_progress', startedAt: new Date() } }).catch(() => {});
  });
  upstream.on('message', (data) => {
    if (client.readyState === WebSocket.OPEN) client.send(data.toString());
  });
  upstream.on('error', () => {
    shutdown('The AI service could not open a live session. Make sure the Python AI service is running and Gemini is configured.');
  });
  upstream.on('close', () => shutdown());

  client.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    switch (msg?.type) {
      case 'audio':
        if (typeof msg.data === 'string' && msg.data.length && msg.data.length <= MAX_AUDIO_B64) toUpstream({ type: 'audio', data: msg.data });
        break;
      case 'advance': {
        const next = Number(msg.index);
        if (Number.isInteger(next) && next > 0 && next < questions.length) {
          toUpstream({ type: 'text', text: `The candidate finished Question ${next}. Briefly acknowledge, then ask Question ${next + 1} exactly as supplied: ${questions[next].question}` });
        }
        break;
      }
      case 'repeat': {
        const index = Number(msg.index);
        if (Number.isInteger(index) && index >= 0 && index < questions.length) {
          toUpstream({ type: 'text', text: `Please repeat Question ${index + 1} exactly as supplied and wait for my answer: ${questions[index].question}` });
        }
        break;
      }
      case 'finish':
        toUpstream({ type: 'text', text: 'The candidate has answered the final question. Thank them briefly and say the interview is complete. Do not ask anything else.' });
        break;
      case 'close':
        shutdown();
        break;
      default:
        break;
    }
  });
  client.on('close', () => shutdown());
  client.on('error', () => shutdown());
}

export function attachLiveRelay(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

  server.on('upgrade', async (req, socket, head) => {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      return reject(socket, 400, 'Bad Request');
    }
    if (url.pathname !== LIVE_PATH) return reject(socket, 404, 'Not Found');

    const origin = (req.headers.origin || '').replace(/\/$/, '');
    if (!origin || !config.clientOrigins.includes(origin)) return reject(socket, 403, 'Forbidden');

    try {
      const token = parseCookies(req.headers.cookie)[config.session.cookieName];
      const session = await findActiveSession(token);
      if (!session) return reject(socket, 401, 'Unauthorized');

      const id = url.searchParams.get('sessionId') || '';
      if (!/^[a-f0-9]{24}$/i.test(id)) return reject(socket, 400, 'Bad Request');
      const interview = await InterviewSession.findOne({ _id: id, owner: session.user, status: { $in: ['ready', 'in_progress'] } })
        .select('+resumeText questions targetRole jobDescription status answers.index')
        .lean();
      if (!interview) return reject(socket, 404, 'Not Found');

      wss.handleUpgrade(req, socket, head, (client) => relay(client, interview));
    } catch {
      reject(socket, 500, 'Internal Server Error');
    }
  });

  return wss;
}
