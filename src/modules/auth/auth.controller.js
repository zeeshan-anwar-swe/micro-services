import * as service from './auth.service.js';

export async function register(req, res) { res.status(201).json({ data: await service.register(req.validated.body) }); }
export async function login(req, res) { res.json({ data: await service.login(req.validated.body) }); }
export async function me(req, res) { res.json({ data: await service.profile(req.user) }); }
