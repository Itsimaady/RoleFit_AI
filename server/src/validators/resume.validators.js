import { z } from 'zod';
import { RESUME_TEMPLATES } from '../models/Resume.js';
import { objectId, trimmed } from './common.js';

const s = (max) => trimmed(max).default('');
const strList = (max, itemMax) => z.array(trimmed(itemMax)).max(max).default([]);
// Optional client-side id for existing sub-documents (keeps React keys stable).
const subId = objectId.optional();

const url = (max) =>
  trimmed(max)
    .refine((v) => !v || /^(https?:\/\/)?[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(v), 'Enter a valid link, e.g. github.com/you')
    .refine((v) => !/^\s*(javascript|data|vbscript):/i.test(v), 'Unsupported link type')
    .default('');

const education = z.object({
  _id: subId,
  institution: s(150),
  degree: s(120),
  field: s(120),
  location: s(120),
  startDate: s(30),
  endDate: s(30),
  grade: s(40),
  details: s(500),
});

const experience = z.object({
  _id: subId,
  role: s(120),
  organization: s(150),
  location: s(120),
  type: s(40),
  startDate: s(30),
  endDate: s(30),
  current: z.boolean().default(false),
  bullets: strList(12, 400),
});

const project = z.object({
  _id: subId,
  name: s(150),
  role: s(120),
  technologies: strList(25, 50),
  link: url(300),
  startDate: s(30),
  endDate: s(30),
  bullets: strList(10, 400),
});

const certification = z.object({ _id: subId, name: s(150), issuer: s(150), date: s(30), link: url(300) });
const achievement = z.object({ _id: subId, title: s(150), description: s(400), date: s(30) });
const link = z.object({ _id: subId, label: s(60), url: url(300) });

export const resumeContentSchema = z.object({
  title: trimmed(100, 1),
  template: z.enum(RESUME_TEMPLATES).default('classic'),
  personal: z
    .object({
      fullName: s(80),
      headline: s(120),
      email: trimmed(254)
        .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Enter a valid email address')
        .default(''),
      phone: trimmed(40)
        .refine((v) => !v || /^[+()\d\s.-]{7,40}$/.test(v), 'Enter a valid phone number')
        .default(''),
      location: s(120),
      website: url(300),
      linkedin: url(300),
      github: url(300),
    })
    .default({}),
  summary: s(1500),
  education: z.array(education).max(10).default([]),
  experience: z.array(experience).max(15).default([]),
  projects: z.array(project).max(15).default([]),
  skills: z.object({ technical: strList(60, 50), interpersonal: strList(30, 50) }).default({}),
  certifications: z.array(certification).max(20).default([]),
  achievements: z.array(achievement).max(20).default([]),
  links: z.array(link).max(10).default([]),
});

export const createResumeSchema = resumeContentSchema.partial({ template: true }).extend({
  title: trimmed(100, 1).default('Untitled resume'),
});

export const updateResumeSchema = resumeContentSchema.extend({
  revision: z.number().int().min(1, 'Revision is required'),
});

export const patchResumeSchema = z
  .object({
    title: trimmed(100, 1).optional(),
    template: z.enum(RESUME_TEMPLATES).optional(),
  })
  .refine((v) => v.title !== undefined || v.template !== undefined, 'Provide a title or template');

export const listResumesQuery = z.object({
  q: trimmed(100).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const exportQuery = z.object({
  layout: z.enum(['jake', 'faangpath', 'awesome', 'rendercv', 'deedy', 'classic', 'modern']).optional(),
});
