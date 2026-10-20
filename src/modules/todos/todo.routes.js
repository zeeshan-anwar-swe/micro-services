import { Router } from 'express';
import { requireAuth } from '../auth/auth.middleware.js';
import { validate, idParams, pagination } from '../../common/validation.js';
import { createBody, updateBody } from './todo.validation.js';
import * as controller from './todo.controller.js';

const router = Router();
router.use(requireAuth);
router.post('/', validate({ body: createBody }), controller.create);
router.get('/', validate({ query: pagination }), controller.list);
router.get('/:id', validate({ params: idParams }), controller.get);
router.put('/:id', validate({ params: idParams, body: updateBody }), controller.update);
router.delete('/:id', validate({ params: idParams }), controller.remove);
export default router;
