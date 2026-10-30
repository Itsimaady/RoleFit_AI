import crypto from 'node:crypto';
import { User } from '../models/User.js';
import { findActiveSession } from '../services/session.service.js';
import { ApiError } from '../utils/errors.js';
import { config } from '../config/env.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Resolves the session cookie to req.user. Never trusts user ids sent by the client. */
export async function loadSession(req, _res, next) {
  try {
    const token = req.cookies?.[config.session.cookieName];
    if (!token) return next();
    const session = await findActiveSession(token);
    if (!session) {
      req.sessionExpired = true;
      return next();
    }
    const user = await User.findById(session.user);
    if (!user) return next();
    req.user = { id: user._id.toString(), doc: user };
    req.sessionToken = token;
    req.authSession = { expiresAt: session.expiresAt };
    return next();
  } catch (err) {
    return next(err);
  }
}

export function requireAuth(req, _res, next) {
  if (req.user) return next();
  if (req.sessionExpired) return next(new ApiError(401, 'session_expired', 'Your session has expired. Please sign in again.'));
  return next(ApiError.unauthorized());
}

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/** Double-submit CSRF protection plus Origin allow-listing for state-changing requests. */
export function csrfProtection(req, _res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.get('origin');
  if (origin && !config.clientOrigins.includes(origin.replace(/\/$/, ''))) {
    return next(new ApiError(403, 'origin_rejected', 'Request origin is not allowed.'));
  }
  const header = req.get('x-csrf-token');
  const cookie = req.cookies?.[config.session.csrfCookieName];
  if (!header || !cookie || !safeEqual(header, cookie)) {
    return next(new ApiError(403, 'csrf_failed', 'Security token missing or invalid. Refresh the page and try again.'));
  }
  return next();
}
