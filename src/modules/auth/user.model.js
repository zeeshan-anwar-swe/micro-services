import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  name: { type: String, required: true, trim: true, maxlength: 100 },
  passwordHash: { type: String, required: true, select: false },
  tenantId: { type: String, required: true, index: true, immutable: true },
  role: { type: String, enum: ['owner', 'member'], default: 'owner', immutable: true },
}, { timestamps: true });

schema.set('toJSON', { transform(_doc, ret) { delete ret.passwordHash; delete ret.__v; return ret; } });
export const User = mongoose.model('User', schema);
