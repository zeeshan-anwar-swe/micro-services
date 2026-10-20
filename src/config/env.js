import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  MONGODB_URI: z.string().regex(/^mongodb(?:\+srv)?:\/\//),
  JWT_SECRET: z.string().min(32).refine(
    (value) => !value.startsWith('replace-with-'), 'Replace the example JWT secret',
  ),
  JWT_EXPIRES_IN: z.string().regex(/^[1-9]\d*[smhd]$/).refine((value) => {
    const unitSeconds = { s: 1, m: 60, h: 3600, d: 86400 };
    return Number(value.slice(0, -1)) * unitSeconds[value.at(-1)] <= 7 * 86400;
  }, 'Token lifetime must be positive and at most 7 days').default('1h'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
  CORS_ORIGINS: z.string().default('*').refine((value) => {
    if (value.trim() === '*') return true;
    return value.split(',').every((entry) => {
      try { const url = new URL(entry.trim()); return ['http:', 'https:'].includes(url.protocol) && url.origin === entry.trim(); }
      catch { return false; }
    });
  }, 'Use * or comma-separated HTTP/HTTPS origins without paths or trailing slashes'),
  SOCKET_ADAPTER: z.enum(['memory', 'mongo']).default('memory'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid environment configuration: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
}
export const env = Object.freeze({
  ...parsed.data,
  corsOrigins: parsed.data.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
  isVercel: process.env.VERCEL === '1',
});
