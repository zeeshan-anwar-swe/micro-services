import mongoose from 'mongoose';
import { env } from './env.js';
import { Tenant, User, Todo, Share, Message } from '../models/index.js';

mongoose.set('strictQuery', true);
mongoose.set('bufferCommands', false);

let connectionPromise;

export function connectDatabase() {
  if (!connectionPromise) {
    connectionPromise = (async () => {
      await mongoose.connect(env.MONGODB_URI, {
        serverSelectionTimeoutMS: 10000, waitQueueTimeoutMS: 10000,
        maxPoolSize: 10, minPoolSize: 0, maxIdleTimeMS: 60000,
      });
      // Concurrent cold-start requests await one pool and the same index setup.
      await Promise.all([Tenant, User, Todo, Share, Message].map((model) => model.init()));
      await mongoose.connection.db.collection('rate_limits').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
      return mongoose.connection;
    })().catch((error) => { connectionPromise = undefined; throw error; });
  }
  return connectionPromise;
}

export async function disconnectDatabase() {
  connectionPromise = undefined;
  await mongoose.disconnect();
}
