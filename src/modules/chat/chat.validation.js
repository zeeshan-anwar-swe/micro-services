import { z } from 'zod';
import { objectId } from '../../common/validation.js';

export const joinPayload = z.object({ todoId: objectId }).strict();
export const messagePayload = z.object({ todoId: objectId, content: z.string().trim().min(1).max(4000) }).strict();
