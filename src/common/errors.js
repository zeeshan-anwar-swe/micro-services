import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(status, message, code = 'REQUEST_ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function publicError(error) {
  if (error instanceof AppError) return { status: error.status, code: error.code, message: error.message };
  if (error instanceof ZodError) return {
    status: 400, code: 'VALIDATION_ERROR', message: 'Invalid input',
    details: error.issues.map(({ path, message }) => ({ field: path.join('.'), message })),
  };
  if (error.code === 11000) return { status: 409, code: 'CONFLICT', message: 'Email, tenant, or share already exists' };
  if (error.name === 'ValidationError' || error.name === 'CastError' || error.type === 'entity.parse.failed') {
    return { status: 400, code: 'VALIDATION_ERROR', message: 'Invalid request data' };
  }
  if (error.type === 'entity.too.large') return { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' };
  return { status: 500, code: 'INTERNAL_ERROR', message: 'Internal server error' };
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  const { status, ...body } = publicError(error);
  if (status === 500) console.error(error);
  res.status(status).json({ error: body });
}
