import rateLimit from 'express-rate-limit';
import { config } from '../config/env.js';

const handler = (_req, res, _next, options) => {
  res.status(options.statusCode).json({
    error: { code: 'rate_limited', message: 'Too many requests. Please wait a moment and try again.' },
  });
};

const make = (windowMs, limit, keyByUser = false) =>
  rateLimit({
    windowMs,
    limit: config.isTest ? 1000 : limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler,
    ...(keyByUser ? { keyGenerator: (req) => (req.user ? `u:${req.user.id}` : req.ip) } : {}),
  });

// Login/registration: brute-force protection per IP.
export const authLimiter = make(15 * 60 * 1000, 20);
// Rule-based analysis is CPU-bound; AI calls cost money. Limit per user.
export const analysisLimiter = make(10 * 60 * 1000, 40, true);
export const aiLimiter = make(10 * 60 * 1000, 60, true);
export const apiLimiter = make(60 * 1000, 300);
