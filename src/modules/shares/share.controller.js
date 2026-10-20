import * as service from './share.service.js';

export async function create(req, res) { res.json({ data: await service.create(req.user, req.validated.body) }); }
export async function sharedWithMe(req, res) { res.json({ data: await service.sharedWithMe(req.user, req.validated.query), pagination: req.validated.query }); }
