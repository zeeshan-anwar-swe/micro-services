import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { AppError } from '../../common/errors.js';
import { User } from './user.model.js';
import { Tenant } from './tenant.model.js';

const tokenOptions = { algorithm: 'HS256', issuer: 'todo-api', audience: 'todo-client' };
let dummyHash;

export function issueToken(user) {
  return jwt.sign({ userId: String(user._id), tenantId: user.tenantId, role: user.role }, env.JWT_SECRET, {
    ...tokenOptions, expiresIn: env.JWT_EXPIRES_IN,
  });
}

export async function register(input) {
  const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_ROUNDS);
  // Unique reservation prevents a public caller from claiming existing membership.
  const tenant = await Tenant.create({ tenantId: input.tenantId });
  let user;
  try {
    user = await User.create({ email: input.email, name: input.name, tenantId: tenant.tenantId, passwordHash, role: 'owner' });
  } catch (error) {
    // Cleanup only this request's reservation; never remove another tenant.
    await Tenant.deleteOne({ _id: tenant._id });
    throw error;
  }
  return { user: user.toJSON(), token: issueToken(user) };
}

export async function login({ email, password }) {
  const user = await User.findOne({ email }).select('+passwordHash');
  dummyHash ??= bcrypt.hash('dummy-password-never-accepted', env.BCRYPT_ROUNDS);
  const matches = await bcrypt.compare(password, user?.passwordHash ?? await dummyHash);
  if (!user || !matches) throw new AppError(401, 'Invalid email or password', 'UNAUTHENTICATED');
  return { user: user.toJSON(), token: issueToken(user) };
}

export async function authenticateToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'], issuer: tokenOptions.issuer, audience: tokenOptions.audience });
    if (!payload || typeof payload !== 'object' || typeof payload.userId !== 'string' || !/^[a-f\d]{24}$/i.test(payload.userId)
      || typeof payload.tenantId !== 'string' || !Number.isInteger(payload.exp)) throw new Error('Invalid claims');
  } catch {
    throw new AppError(401, 'Invalid or expired token', 'UNAUTHENTICATED');
  }
  const user = await User.findOne({ _id: payload.userId, tenantId: payload.tenantId });
  if (!user || user.role !== payload.role) throw new AppError(401, 'Invalid or expired token', 'UNAUTHENTICATED');
  return { userId: String(user._id), tenantId: user.tenantId, role: user.role, tokenExpiresAt: payload.exp * 1000 };
}

export async function profile(actor) {
  return User.findOne({ _id: actor.userId, tenantId: actor.tenantId });
}
