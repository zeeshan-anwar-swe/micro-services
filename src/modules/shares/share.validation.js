import { z } from 'zod';
import { objectId, email } from '../../common/validation.js';

export const shareBody = z.object({ todoId: objectId, recipientEmail: email, permission: z.enum(['view', 'edit']) }).strict();
