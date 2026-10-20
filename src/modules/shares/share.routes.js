import { Router } from 'express';
import { requireAuth } from '../auth/auth.middleware.js';
import { validate, pagination } from '../../common/validation.js';
import { shareBody } from './share.validation.js';
import * as controller from './share.controller.js';

const router = Router();
router.use(requireAuth);
router.post('/', validate({ body: shareBody }), controller.create);
router.get('/shared-with-me', validate({ query: pagination }), controller.sharedWithMe);
export default router;
