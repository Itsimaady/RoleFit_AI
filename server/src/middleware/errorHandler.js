import mongoose from 'mongoose';
import { ApiError } from '../utils/errors.js';
import { config } from '../config/env.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'not_found', message: `No route for ${req.method} ${req.path}` } });
}

// Centralized error handler: consistent JSON, no stack traces to clients.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
    });
  }

  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'payload_too_large', message: 'Request body is too large.' } });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'invalid_json', message: 'Request body must be valid JSON.' } });
  }
  if (err instanceof mongoose.Error.ValidationError) {
    const details = Object.values(err.errors).map((e) => ({ path: e.path, message: e.message }));
    return res.status(400).json({ error: { code: 'validation_error', message: 'Validation failed.', details } });
  }
  if (err instanceof mongoose.Error.CastError) {
    return res.status(400).json({ error: { code: 'invalid_id', message: 'Invalid identifier.' } });
  }
  if (err?.code === 11000) {
    return res.status(409).json({ error: { code: 'conflict', message: 'A record with these details already exists.' } });
  }
  const dbDown = mongoose.connection.readyState !== 1 && /^Mongo/.test(err?.name || '');
  if (dbDown || err?.name === 'MongooseServerSelectionError' || err?.name === 'MongoNotConnectedError') {
    return res.status(503).json({ error: { code: 'database_unavailable', message: 'Database is unavailable. Try again shortly.' } });
  }

  // Log only safe metadata: never the request body (may contain passwords/resume data).
  if (!config.isTest) {
    console.error(`[error] ${req.method} ${req.originalUrl}:`, err?.stack || err);
  }
  return res.status(500).json({
    error: {
      code: 'internal_error',
      message: 'Something went wrong on our side.',
      ...(config.isProduction ? {} : { debug: String(err?.message || err) }),
    },
  });
}
