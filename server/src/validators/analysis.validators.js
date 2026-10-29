import { z } from 'zod';
import { config } from '../config/env.js';
import { objectId, trimmed } from './common.js';

const { minJobDescriptionChars: min, maxJobDescriptionChars: max } = config.analysis;

export const jobDescription = z
  .string({ required_error: 'Job description is required' })
  .trim()
  .min(min, `Job description must be at least ${min} characters so the comparison is meaningful`)
  .max(max, `Job description must be at most ${max.toLocaleString('en-US')} characters`);

export const createAnalysisSchema = z.object({
  resumeId: objectId,
  jobDescription,
  targetRole: trimmed(120).default(''),
});

export const listAnalysesQuery = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  resumeId: objectId.optional(),
});
