import mongoose from 'mongoose';
import { createAdapter } from '@socket.io/mongo-adapter';

export async function mongoSocketAdapter() {
  const db = mongoose.connection.db;
  const topology = await db.admin().command({ hello: 1 });
  if (!topology.setName && topology.msg !== 'isdbgrid') {
    throw new Error('Distributed chat requires a MongoDB replica set or sharded cluster. Use MongoDB Atlas for Vercel.');
  }
  const events = db.collection('socket_events');
  await events.createIndex({ createdAt: 1 }, { expireAfterSeconds: 3600 });
  return createAdapter(events, { addCreatedAtField: true });
}
