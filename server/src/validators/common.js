import { z } from 'zod';

export const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid identifier');
export const idParams = z.object({ id: objectId });

export const pagination = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const trimmed = (max, min = 0) => z.string().trim().min(min).max(max);
