import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  tenantId: { type: String, required: true, unique: true, immutable: true },
}, { timestamps: true });

export const Tenant = mongoose.model('Tenant', schema);
