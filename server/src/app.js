import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config/env.js';
import { loadSession, csrfProtection } from './middleware/auth.js';
import { apiLimiter } from './middleware/rateLimiter.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import authRoutes from './routes/auth.routes.js';
import resumeRoutes from './routes/resume.routes.js';
import analysisRoutes from './routes/analysis.routes.js';
import interviewRoutes from './routes/interview.routes.js';
import aiRoutes from './routes/ai.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import healthRoutes from './routes/health.routes.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);

  app.use(
    helmet({
      // The SPA (when served from here) loads MediaPipe WASM/models from these CDNs.
      contentSecurityPolicy: {
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'", "'wasm-unsafe-eval'", 'https://cdn.jsdelivr.net'],
          'connect-src': ["'self'", 'https://cdn.jsdelivr.net', 'https://storage.googleapis.com', ...config.clientOrigins],
          'img-src': ["'self'", 'data:', 'blob:'],
          'media-src': ["'self'", 'blob:'],
          'style-src': ["'self'", "'unsafe-inline'"],
          'worker-src': ["'self'", 'blob:'],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(
    cors({
      origin(origin, cb) {
        // Same-origin and non-browser requests have no Origin header.
        if (!origin || config.clientOrigins.includes(origin.replace(/\/$/, ''))) return cb(null, true);
        return cb(null, false);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
      exposedHeaders: ['Content-Disposition'],
    }),
  );
  app.use(express.json({ limit: config.bodyLimit }));
  app.use(cookieParser());

  app.use('/api', apiLimiter);
  app.use('/api/health', healthRoutes);
  app.use('/api', loadSession, csrfProtection);
  app.use('/api/auth', authRoutes);
  app.use('/api/resumes', resumeRoutes);
  app.use('/api/analyses', analysisRoutes);
  app.use('/api/interviews', interviewRoutes);
  app.use('/api/ai', aiRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api', notFoundHandler);

  // Optional single-origin production deployment: serve the built React app.
  if (config.serveClient) {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const dist = path.resolve(here, '..', config.clientDist);
    if (fs.existsSync(path.join(dist, 'index.html'))) {
      app.use(express.static(dist, { index: false, maxAge: '1h' }));
      // SPA fallback so refreshing a client route works.
      app.get('/{*splat}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
    } else {
      console.warn(`[app] SERVE_CLIENT is on but ${dist}/index.html was not found. Run "npm run build" in frontend/.`);
    }
  }

  app.use(errorHandler);
  return app;
}
