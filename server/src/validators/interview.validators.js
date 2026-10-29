import { z } from 'zod';
import { objectId, trimmed } from './common.js';
import { CATEGORIES, DIFFICULTIES, RESPONSE_STATUSES } from '../models/InterviewSession.js';
import { jobDescription } from './analysis.validators.js';

export const createInterviewSchema = z.object({
  resumeId: objectId,
  targetRole: trimmed(120, 2),
  jobDescription,
});

const metric = z.number().min(0).max(100).nullable().optional();

export const answerSchema = z.object({
  index: z.number().int().min(0).max(29),
  answer: trimmed(20000, 1),
  vision: z
    .object({
      facial: metric,
      eyeContact: metric,
      posture: metric,
      bodyMovement: metric,
      communication: metric,
      samples: z.number().int().min(0).max(100000).optional(),
    })
    .default({}),
});

export const listInterviewsQuery = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const rewriteSchema = z.object({
  text: trimmed(400, 5),
  context: trimmed(200).default(''),
  jobDescription: z.string().trim().max(20000).default(''),
});

// ---------------------------------------------------------------- guided mode

const optionalJd = z.string().trim().max(20000, 'Job description must be at most 20,000 characters').default('');

export const guidedCreateSchema = z
  .object({
    mode: z.literal('guided'),
    resumeId: objectId.optional(),
    jobDescription: optionalJd,
    targetRole: trimmed(120).default(''),
    company: trimmed(120).default(''),
    language: trimmed(40).default(''),
    durationMinutes: z.number().int().min(5).max(120).optional(),
    difficulty: z.enum(DIFFICULTIES),
    category: z.enum(CATEGORIES),
    questionCount: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(20)]),
    visualCoaching: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.category === 'Resume-Based Interview' && !v.resumeId) ctx.addIssue({ code: 'custom', path: ['resumeId'], message: 'Choose a resume for a resume-based interview' });
    if (v.category === 'Job Description-Based Interview' && v.jobDescription.length < 80)
      ctx.addIssue({ code: 'custom', path: ['jobDescription'], message: 'Paste the job description (at least 80 characters)' });
  });

export const createAnyInterviewSchema = z.preprocess(
  (v) => (v && typeof v === 'object' && !('mode' in v) ? { ...v, mode: 'live' } : v),
  z.discriminatedUnion('mode', [createInterviewSchema.extend({ mode: z.literal('live') }), guidedCreateSchema.innerType()]),
);

const pct = z.number().min(0).max(100).nullable().optional();

export const guidedResponseSchema = z
  .object({
    index: z.number().int().min(0).max(19),
    status: z.enum(RESPONSE_STATUSES),
    transcript: z.string().trim().max(12000).default(''),
    inputMethod: z.enum(['voice', 'typed', 'voice_edited']).default('voice'),
    recognition: z
      .object({ restarts: z.number().int().min(0).max(1000).default(0), errors: z.array(trimmed(40)).max(20).default([]) })
      .default({}),
    durationSeconds: z.number().min(0).max(7200).optional(),
    visual: z
      .object({ samples: z.number().int().min(0).max(100000), faceInFramePct: pct, facingCameraPct: pct, lookAwayEvents: z.number().int().min(0).max(10000).optional() })
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (v.status === 'answered' && !v.transcript) ctx.addIssue({ code: 'custom', path: ['transcript'], message: 'An answered question needs a transcript' });
    if (v.status === 'answered_but_empty' && v.transcript) ctx.addIssue({ code: 'custom', path: ['transcript'], message: 'An empty answer cannot have a transcript' });
  });

export const responseParams = z.object({ id: objectId, index: z.coerce.number().int().min(0).max(19) });

export const practiceSchema = z.object({ kind: z.enum(['skipped', 'weak']) });
