import { Todo } from './todo.model.js';
import { Share } from '../shares/share.model.js';
import { AppError } from '../../common/errors.js';

export async function requireTodoAccess(actor, todoId, action = 'view') {
  const todo = await Todo.findOne({ _id: todoId, deletedAt: null });
  const hidden = () => new AppError(404, 'Todo not found', 'NOT_FOUND');
  if (!todo) throw hidden();
  const sameTenant = todo.tenantId === actor.tenantId;
  const owner = sameTenant && String(todo.ownerId) === actor.userId;
  if (action === 'owner') {
    if (!owner) throw hidden();
    return todo;
  }
  if (sameTenant) return todo;
  const share = await Share.findOne({ todoId: todo._id, tenantId: todo.tenantId, recipientId: actor.userId });
  if (!share) throw hidden();
  if (action === 'edit' && share.permission !== 'edit') throw new AppError(403, 'Edit permission required', 'FORBIDDEN');
  return todo;
}
