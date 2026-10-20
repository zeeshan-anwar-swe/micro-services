import * as service from './chat.service.js';

export async function history(req, res) {
  res.json({ data: await service.history(req.user, req.validated.params.todoId, req.validated.query), pagination: req.validated.query });
}
