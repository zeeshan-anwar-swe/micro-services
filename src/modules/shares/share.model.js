import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  tenantId: { type: String, required: true, immutable: true },
  todoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Todo', required: true, immutable: true },
  recipientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  sharedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  permission: { type: String, enum: ['view', 'edit'], required: true },
}, { timestamps: true });
schema.index({ todoId: 1, recipientId: 1 }, { unique: true });
schema.index({ recipientId: 1, createdAt: -1, _id: -1 });
export const Share = mongoose.model('Share', schema);
