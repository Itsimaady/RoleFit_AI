import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { routes } from '../App.jsx';
import { mockApi, renderRoutes, testUser } from './utils.jsx';
import { createChunker, deliveryHeuristic, downsample, pcmBase64 } from '../features/interview/audio.js';

const authed = { 'GET /api/auth/me': () => [200, { user: testUser }] };
const empty = { items: [], total: 0, page: 1, pages: 0 };

describe('interview audio helpers', () => {
  it('downsamples 48 kHz to 16 kHz', () => {
    expect(downsample(new Float32Array(480), 48000)).toHaveLength(160);
  });
  it('encodes 16-bit PCM as base64 (2 bytes per sample)', () => {
    expect(atob(pcmBase64(new Float32Array([0, 1, -1]))).length).toBe(6);
  });
  it('batches small frames into larger chunks', () => {
    const chunks = [];
    const c = createChunker((x) => chunks.push(x.length), 100);
    for (let i = 0; i < 5; i++) c.push(new Float32Array(43));
    expect(chunks).toEqual([129]);
  });
  it('returns null delivery heuristic for an empty transcript', () => {
    expect(deliveryHeuristic('   ')).toBeNull();
    expect(deliveryHeuristic('um um um like')).toBeLessThan(deliveryHeuristic('I designed the API schema and wrote integration tests'));
  });
});

describe('InterviewsPage', () => {
  it('explains when live interviews are unavailable and disables setup', async () => {
    mockApi({
      ...authed,
      'GET /api/interviews/availability': () => [200, { ready: false, aiServiceReachable: true, geminiConfigured: false, message: 'Gemini is not configured. Add GEMINI_API_KEY to backend/.env and restart the AI service.' }],
      'GET /api/resumes': () => [200, { ...empty, items: [{ _id: 'r1', title: 'Backend Resume' }], total: 1 }],
      'GET /api/interviews': () => [200, empty],
    });
    renderRoutes(routes, '/app/interviews');
    expect(await screen.findByText(/live interviews are not available/i)).toBeInTheDocument();
    expect(screen.getByText(/Gemini is not configured/)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /prepare interview/i })).toBeDisabled();
    expect(screen.getByText(/Video never leaves your browser/)).toBeInTheDocument();
  });

  it('asks for a resume first when the user has none', async () => {
    mockApi({
      ...authed,
      'GET /api/interviews/availability': () => [200, { ready: true }],
      'GET /api/resumes': () => [200, empty],
      'GET /api/interviews': () => [200, empty],
    });
    renderRoutes(routes, '/app/interviews');
    expect(await screen.findByText('You need a resume first')).toBeInTheDocument();
  });
});

describe('InterviewReportPage', () => {
  it('shows unmeasured components honestly and labels estimated feedback', async () => {
    mockApi({
      ...authed,
      'GET /api/interviews/s1': () => [
        200,
        {
          session: {
            _id: 's1',
            targetRole: 'Backend Intern',
            resumeTitle: 'Backend Resume',
            status: 'completed',
            questions: Array.from({ length: 12 }, (_, i) => ({ question: `Q${i + 1}` })),
            answers: [{ index: 0, round: 'Technical', question: 'Explain REST', answer: 'REST uses HTTP verbs.', score: 60, feedback: 'Estimated.', aiUsed: false }],
            report: {
              overall_score: 60,
              components: { answer_technical_quality: { weight: 40, score: 60 }, facial_expression: { weight: 15, score: null } },
              weighting_note: 'Components with no measurements are excluded and the remaining weights are re-normalized.',
              ai_used: false,
              strengths: [],
              improvements: [],
              topics: [],
              summary: 'AI review was unavailable.',
            },
          },
        },
      ],
    });
    renderRoutes(routes, '/app/interviews/s1');
    expect(await screen.findByText('Not measured')).toBeInTheDocument();
    expect(screen.getByText(/estimated without AI/i)).toBeInTheDocument();
    expect(screen.getByText('Rule-based')).toBeInTheDocument();
    expect(screen.getByText('REST uses HTTP verbs.')).toBeInTheDocument();
    expect(screen.getByText(/11 question\(s\) were not answered/)).toBeInTheDocument();
  });
});
