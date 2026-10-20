import { Message } from './message.model.js';
import { requireTodoAccess } from '../todos/todo.access.js';

export async function history(actor, todoId, { limit, offset }) {
  const todo = await requireTodoAccess(actor, todoId);
  const messages = await Message.find({ todoId: todo._id, tenantId: todo.tenantId })
    .sort({ createdAt: -1, _id: -1 }).skip(offset).limit(limit);
  return messages.reverse();
}
export async function send(actor, { todoId, content }) {
  const todo = await requireTodoAccess(actor, todoId);
  return Message.create({ todoId: todo._id, tenantId: todo.tenantId, senderId: actor.userId, content });
}
