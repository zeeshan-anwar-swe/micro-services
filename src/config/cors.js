import { env } from './env.js';

export const corsOrigin = env.corsOrigins.includes('*') ? '*' : env.corsOrigins;
export const isOriginAllowed = (origin) => !origin || corsOrigin === '*' || env.corsOrigins.includes(origin);
