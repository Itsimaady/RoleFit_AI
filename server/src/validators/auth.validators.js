import { z } from 'zod';

const email = z
  .string({ required_error: 'Email is required' })
  .trim()
  .toLowerCase()
  .max(254, 'Email is too long')
  .email('Enter a valid email address');

// bcrypt ignores bytes after 72, so cap the length to avoid silent truncation.
export const password = z
  .string({ required_error: 'Password is required' })
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters')
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Password must contain at least one letter and one number')
  .refine((v) => Buffer.byteLength(v, 'utf8') <= 72, 'Password is too long');

export const registerSchema = z
  .object({
    fullName: z.string({ required_error: 'Full name is required' }).trim().min(2, 'Full name must be at least 2 characters').max(80),
    email,
    password,
    confirmPassword: z.string({ required_error: 'Please confirm your password' }),
  })
  .refine((v) => v.password === v.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' });

export const loginSchema = z.object({
  email,
  password: z.string({ required_error: 'Password is required' }).min(1, 'Password is required').max(200),
});

export const profileSchema = z.object({
  fullName: z.string().trim().min(2).max(80).optional(),
  profile: z
    .object({
      headline: z.string().trim().max(120).optional(),
      targetRole: z.string().trim().max(120).optional(),
      location: z.string().trim().max(120).optional(),
    })
    .optional(),
});
