import http from 'node:http';
import { env } from './config/env.js';
import { connectDatabase } from './config/database.js';
import { mongoSocketAdapter } from './config/socket-adapter.js';
import { createApp } from './app.js';
import { attachChat } from './modules/chat/chat.socket.js';

export async function createRuntime({ distributed = env.isVercel || env.SOCKET_ADAPTER === 'mongo' } = {}) {
  await connectDatabase();
  const adapter = distributed ? await mongoSocketAdapter() : undefined;
  const app = createApp();
  const server = http.createServer(app);
  const io = attachChat(server, { adapter, distributed });
  app.set('io', io);
  return { app, server, io };
}
