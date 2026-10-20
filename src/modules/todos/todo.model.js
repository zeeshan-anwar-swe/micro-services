import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  tenantId: { type: String, required: true, immutable: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  description: { type: String, default: '', maxlength: 5000 },
  status: { type: String, enum: ['pending', 'in_progress', 'completed'], default: 'pending' },
  dueDate: { type: Date, default: null },
  deletedAt: { type: Date, default: null, select: false },
}, { timestamps: true });
schema.index({ tenantId: 1, deletedAt: 1, createdAt: -1, _id: -1 });
export const Todo = mongoose.model('Todo', schema);
