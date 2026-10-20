import { Share } from './share.model.js';
import { User } from '../auth/user.model.js';
import { requireTodoAccess } from '../todos/todo.access.js';
import { AppError } from '../../common/errors.js';

export async function create(actor, { todoId, recipientEmail, permission }) {
  const todo = await requireTodoAccess(actor, todoId, 'owner');
  const recipient = await User.findOne({ email: recipientEmail });
  if (!recipient) throw new AppError(404, 'Recipient not found', 'NOT_FOUND');
  if (recipient.tenantId === actor.tenantId) throw new AppError(400, 'Users in this tenant already have access');
  return Share.findOneAndUpdate({ todoId: todo._id, recipientId: recipient._id }, {
    $set: { permission }, $setOnInsert: { tenantId: todo.tenantId, sharedBy: actor.userId },
  }, { upsert: true, returnDocument: 'after', runValidators: true, setDefaultsOnInsert: true });
}
export async function sharedWithMe(actor, { limit, offset }) {
  // Filter deleted parents before pagination so each page contains live shared todos.
  return Share.aggregate([
    { $match: { recipientId: new Share.base.Types.ObjectId(actor.userId) } },
    { $lookup: { from: 'todos', localField: 'todoId', foreignField: '_id', as: 'todo' } },
    { $unwind: '$todo' },
    { $match: { 'todo.deletedAt': null, $expr: { $eq: ['$tenantId', '$todo.tenantId'] } } },
    { $sort: { createdAt: -1, _id: -1 } }, { $skip: offset }, { $limit: limit },
    { $project: { permission: 1, sharedBy: 1, createdAt: 1, todo: { _id: 1, tenantId: 1, ownerId: 1, title: 1, description: 1, status: 1, dueDate: 1, createdAt: 1, updatedAt: 1 } } },
  ]);
}
