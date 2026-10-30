import crypto from 'node:crypto';
import { Session } from '../models/Session.js';
import { config } from '../config/env.js';

const { cookieName, csrfCookieName, ttlHours, secure, sameSite } = config.session;

export const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
export const randomToken = () => crypto.randomBytes(32).toString('base64url');

const baseCookie = () => ({ secure, sameSite, path: '/' });

export async function createSession(userId, userAgent = '') {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  await Session.create({ tokenHash: hashToken(token), user: userId, expiresAt, userAgent: String(userAgent).slice(0, 200) });
  return { token, expiresAt };
}

export async function findActiveSession(token) {
  if (!token || typeof token !== 'string' || token.length > 100) return null;
  return Session.findOne({ tokenHash: hashToken(token), expiresAt: { $gt: new Date() } }).lean();
}

export async function destroySession(token) {
  if (!token || typeof token !== 'string') return;
  await Session.deleteOne({ tokenHash: hashToken(token) });
}

export function setSessionCookie(res, token, expiresAt) {
  res.cookie(cookieName, token, { ...baseCookie(), httpOnly: true, expires: expiresAt });
}

export function clearSessionCookie(res) {
  res.clearCookie(cookieName, { ...baseCookie(), httpOnly: true });
}

// CSRF double-submit token: readable by the SPA, echoed back in X-CSRF-Token.
export function issueCsrfToken(req, res) {
  const existing = req.cookies?.[csrfCookieName];
  const token = typeof existing === 'string' && /^[A-Za-z0-9_-]{43}$/.test(existing) ? existing : randomToken();
  res.cookie(csrfCookieName, token, { ...baseCookie(), httpOnly: false, maxAge: ttlHours * 60 * 60 * 1000 });
  return token;
}
