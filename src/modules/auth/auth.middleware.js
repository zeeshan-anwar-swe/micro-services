import { AppError } from '../../common/errors.js';
import { authenticateToken } from './auth.service.js';

export async function requireAuth(req, res, next) {
  try {
    const match = /^Bearer (\S+)$/i.exec(req.headers.authorization ?? '');
    if (!match) throw new AppError(401, 'Bearer token required', 'UNAUTHENTICATED');
    req.user = await authenticateToken(match[1]);
    next();
  } catch (error) { next(error); }
}
