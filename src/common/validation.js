import { z } from 'zod';

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Must be a MongoDB ObjectId');
export const idParams = z.object({ id: objectId }).strict();
export const todoParams = z.object({ todoId: objectId }).strict();
export const email = z.string().trim().toLowerCase().email().max(254);
export const pagination = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
}).strict();

export const validate = (schemas) => (req, res, next) => {
  try {
    req.validated = Object.fromEntries(Object.entries(schemas).map(([key, schema]) => [key, schema.parse(req[key])]));
    next();
  } catch (error) { next(error); }
};
