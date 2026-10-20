import * as service from './todo.service.js';

export async function create(req, res) { res.status(201).json({ data: await service.create(req.user, req.validated.body) }); }
export async function list(req, res) { res.json({ data: await service.list(req.user, req.validated.query), pagination: req.validated.query }); }
export async function get(req, res) { res.json({ data: await service.get(req.user, req.validated.params.id) }); }
export async function update(req, res) { res.json({ data: await service.update(req.user, req.validated.params.id, req.validated.body) }); }
export async function remove(req, res) { await service.remove(req.user, req.validated.params.id, req.app.get('io')); res.status(204).end(); }
