import { Router } from 'express';
import { requireAuth } from '../auth/auth.middleware.js';
import { validate, todoParams, pagination } from '../../common/validation.js';
import * as controller from './chat.controller.js';

const router = Router();
router.use(requireAuth);
router.get('/history/:todoId', validate({ params: todoParams, query: pagination }), controller.history);
export default router;
