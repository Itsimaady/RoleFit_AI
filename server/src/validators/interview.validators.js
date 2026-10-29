import { z } from 'zod';
import { objectId, trimmed } from './common.js';
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
