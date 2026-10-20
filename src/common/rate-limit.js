import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { rateLimit } from 'express-rate-limit';

// MongoDB provides atomic counters shared by every Vercel function instance.
export class MongoRateLimitStore {
  localKeys = false;
  constructor(prefix) { this.prefix = prefix; }
  init({ windowMs }) { this.windowMs = windowMs; }
  collection() { return mongoose.connection.db.collection('rate_limits'); }
  identity(key) { return `${this.prefix}:${createHash('sha256').update(key).digest('hex')}`; }
  bucket(key) {
    const window = Math.floor(Date.now() / this.windowMs);
    return { _id: `${this.identity(key)}:${window}`, key: this.identity(key), expiresAt: new Date((window + 1) * this.windowMs) };
  }
  async increment(key) {
    const { _id, ...fields } = this.bucket(key);
    const update = { $inc: { totalHits: 1 }, $setOnInsert: fields };
    let document;
    try {
      document = await this.collection().findOneAndUpdate({ _id }, update, { upsert: true, returnDocument: 'after' });
    } catch (error) {
      if (error.code !== 11000) throw error;
      document = await this.collection().findOneAndUpdate({ _id }, { $inc: { totalHits: 1 } }, { returnDocument: 'after' });
    }
    return { totalHits: document.totalHits, resetTime: document.expiresAt };
  }
  async decrement(key) { await this.collection().updateOne({ _id: this.bucket(key)._id, totalHits: { $gt: 0 } }, { $inc: { totalHits: -1 } }); }
  async resetKey(key) { await this.collection().deleteMany({ key: this.identity(key) }); }
}

export function createRateLimiter(prefix, options) {
  return rateLimit({
    standardHeaders: 'draft-8', legacyHeaders: false,
    store: new MongoRateLimitStore(prefix), ...options,
  });
}
