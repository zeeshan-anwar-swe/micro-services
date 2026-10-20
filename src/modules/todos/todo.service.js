import { Todo } from './todo.model.js';
import { requireTodoAccess } from './todo.access.js';
import { AppError } from '../../common/errors.js';

export async function create(actor, input) {
  return Todo.create({ ...input, tenantId: actor.tenantId, ownerId: actor.userId });
}
export async function list(actor, { limit, offset }) {
  return Todo.find({ tenantId: actor.tenantId, deletedAt: null }).sort({ createdAt: -1, _id: -1 }).skip(offset).limit(limit);
}
export async function get(actor, id) { return requireTodoAccess(actor, id); }
export async function update(actor, id, input) {
  const todo = await requireTodoAccess(actor, id, 'edit');
  const result = await Todo.findOneAndUpdate({ _id: todo._id, tenantId: todo.tenantId, deletedAt: null }, { $set: input }, { returnDocument: 'after', runValidators: true });
  if (!result) throw new AppError(404, 'Todo not found', 'NOT_FOUND');
  return result;
}
export async function remove(actor, id, io) {
  await requireTodoAccess(actor, id, 'owner');
  // Soft deletion makes parent visibility the access boundary for all related records.
  const result = await Todo.updateOne({ _id: id, tenantId: actor.tenantId, ownerId: actor.userId, deletedAt: null }, { $set: { deletedAt: new Date() } });
  if (!result.modifiedCount) throw new AppError(404, 'Todo not found', 'NOT_FOUND');
  io?.in(id.toLowerCase()).socketsLeave(id.toLowerCase());
}
