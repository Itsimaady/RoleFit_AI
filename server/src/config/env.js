import 'dotenv/config';

const bool = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const int = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';

const sameSite = (process.env.COOKIE_SAMESITE || 'lax').toLowerCase();
if (!['lax', 'strict', 'none'].includes(sameSite)) {
  throw new Error('COOKIE_SAMESITE must be one of: lax, strict, none');
}

export const config = {
  nodeEnv,
  isProduction,
  isTest: nodeEnv === 'test',
  port: int(process.env.PORT, 5000),
  host: process.env.HOST || '127.0.0.1',
  mongoUri: process.env.MONGODB_URI || '',
  clientOrigins: (process.env.CLIENT_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((x) => x.trim().replace(/\/$/, ''))
    .filter(Boolean),
  session: {
    cookieName: 'rf_session',
    csrfCookieName: 'rf_csrf',
    ttlHours: int(process.env.SESSION_TTL_HOURS, 12),
    // Secure cookies are required whenever SameSite=None, and always in production.
    secure: bool(process.env.COOKIE_SECURE, isProduction || sameSite === 'none'),
    sameSite,
  },
  bodyLimit: process.env.BODY_LIMIT || '200kb',
  aiService: {
    url: (process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000').replace(/\/$/, ''),
    token: process.env.AI_SERVICE_TOKEN || '',
    timeoutMs: int(process.env.AI_SERVICE_TIMEOUT_MS, 60000),
  },
  analysis: {
    minJobDescriptionChars: 80,
    maxJobDescriptionChars: 20000,
  },
  serveClient: bool(process.env.SERVE_CLIENT, false),
  clientDist: process.env.CLIENT_DIST || '../frontend/dist',
  trustProxy: int(process.env.TRUST_PROXY, 0),
};
