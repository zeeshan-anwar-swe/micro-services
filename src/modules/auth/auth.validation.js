import { z } from 'zod';
import { email } from '../../common/validation.js';

const password = z.string().min(8).refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'Password must not exceed 72 UTF-8 bytes');
export const registerBody = z.object({
  email, password, name: z.string().trim().min(1).max(100),
  tenantId: z.string().trim().min(3).max(64).regex(/^[a-z0-9][a-z0-9_-]*$/, 'Use lowercase letters, numbers, underscores, or hyphens'),
}).strict();
export const loginBody = z.object({ email, password }).strict();
