import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createRateLimiter } from './common/rate-limit.js';
import mongoose from 'mongoose';
import { env } from './config/env.js';
import { corsOrigin } from './config/cors.js';
import { connectDatabase } from './config/database.js';
import { AppError, errorHandler } from './common/errors.js';
import authRoutes from './modules/auth/auth.routes.js';
import todoRoutes from './modules/todos/todo.routes.js';
import shareRoutes from './modules/shares/share.routes.js';
import chatRoutes from './modules/chat/chat.routes.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Vercel overwrites X-Forwarded-For at its ingress. Local direct requests do not trust it.
  if (env.isVercel) app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: corsOrigin, methods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'], maxAge: 86400 }));
  app.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.get('/health', (_req, res) => {
    const ready = mongoose.connection.readyState === 1;
    res.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'unavailable' });
  });
  app.use(async (_req, _res, next) => {
    try { await connectDatabase(); next(); } catch (error) { next(error); }
  });
  app.use(createRateLimiter('http', { windowMs: 60000, limit: 300,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many requests' } } }));
  app.use(express.json({ limit: '32kb' }));
  app.get('/', (_req, res) => res.json({ name: 'Todo Collaboration API', version: 'v1', api: '/api/v1', health: '/health', socketPath: '/socket.io' }));
  app.use('/api/v1/auth', authRoutes());
  app.use('/api/v1/todos', todoRoutes);
  app.use('/api/v1/shares', shareRoutes);
  app.use('/api/v1/chat', chatRoutes);
  app.use((_req, _res, next) => next(new AppError(404, 'Route not found', 'NOT_FOUND')));
  app.use(errorHandler);
  return app;
}
