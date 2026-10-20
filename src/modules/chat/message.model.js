import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  tenantId: { type: String, required: true, immutable: true },
  todoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Todo', required: true, immutable: true },
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  content: { type: String, required: true, trim: true, maxlength: 4000 },
}, { timestamps: true });
schema.index({ todoId: 1, tenantId: 1, createdAt: -1, _id: -1 });
export const Message = mongoose.model('Message', schema);
