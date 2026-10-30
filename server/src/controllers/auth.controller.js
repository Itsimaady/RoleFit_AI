import bcrypt from 'bcryptjs';
import { User } from '../models/User.js';
import { config } from '../config/env.js';
import { ApiError } from '../utils/errors.js';
import {
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  issueCsrfToken,
} from '../services/session.service.js';

// Compared against when the email is unknown so response timing does not reveal registered emails.
const DUMMY_HASH = bcrypt.hashSync('rolefit-timing-equalizer', 12);

async function startSession(req, res, user) {
  const { token, expiresAt } = await createSession(user._id, req.get('user-agent'));
  setSessionCookie(res, token, expiresAt);
  return expiresAt;
}

export async function csrf(req, res) {
  res.json({ csrfToken: issueCsrfToken(req, res) });
}

export async function register(req, res) {
  const { fullName, email, password } = req.body;
  if (await User.exists({ email })) {
    throw ApiError.conflict('An account with this email already exists. Try signing in instead.');
  }
  let user;
  try {
    user = await User.create({ fullName, email, passwordHash: await User.hashPassword(password) });
  } catch (err) {
    if (err?.code === 11000) throw ApiError.conflict('An account with this email already exists. Try signing in instead.');
    throw err;
  }
  const expiresAt = await startSession(req, res, user);
  res.status(201).json({ user: user.toSafeJSON(), sessionExpiresAt: expiresAt });
}

export async function login(req, res) {
  const { email, password } = req.body;
  const user = await User.findOne({ email }).select('+passwordHash');
  const ok = await bcrypt.compare(password, user?.passwordHash || DUMMY_HASH);
  if (!user || !ok) throw new ApiError(401, 'invalid_credentials', 'Incorrect email or password.');
  user.lastLoginAt = new Date();
  await user.save();
  const expiresAt = await startSession(req, res, user);
  res.json({ user: user.toSafeJSON(), sessionExpiresAt: expiresAt });
}

export async function logout(req, res) {
  await destroySession(req.cookies?.[config.session.cookieName]);
  clearSessionCookie(res);
  res.json({ ok: true });
}

export async function me(req, res) {
  res.json({ user: req.user.doc.toSafeJSON(), sessionExpiresAt: req.authSession?.expiresAt || null });
}

export async function updateProfile(req, res) {
  const user = req.user.doc;
  if (req.body.fullName) user.fullName = req.body.fullName;
  if (req.body.profile) {
    for (const [key, value] of Object.entries(req.body.profile)) {
      if (value !== undefined) user.profile[key] = value;
    }
  }
  await user.save();
  res.json({ user: user.toSafeJSON() });
}
