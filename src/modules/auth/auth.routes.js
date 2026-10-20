import { Router } from 'express';
import { createRateLimiter } from '../../common/rate-limit.js';
import { validate } from '../../common/validation.js';
import { loginBody, registerBody } from './auth.validation.js';
import { requireAuth } from './auth.middleware.js';
import * as controller from './auth.controller.js';

export default function authRoutes() {
  const router = Router();
  const limiter = createRateLimiter('auth', {
    windowMs: 15 * 60 * 1000,
    limit: 30,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many authentication attempts' } },
  });
  router.post('/register', limiter, validate({ body: registerBody }), controller.register);
  router.post('/login', limiter, validate({ body: loginBody }), controller.login);
  router.get('/me', requireAuth, controller.me);
  return router;
}
