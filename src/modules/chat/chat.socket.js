import { Server } from 'socket.io';
import { corsOrigin, isOriginAllowed } from '../../config/cors.js';
import { connectDatabase } from '../../config/database.js';
import { AppError, publicError } from '../../common/errors.js';
import { authenticateToken } from '../auth/auth.service.js';
import { requireTodoAccess } from '../todos/todo.access.js';
import { joinPayload, messagePayload } from './chat.validation.js';
import * as service from './chat.service.js';

export function attachChat(server, { adapter, distributed = false } = {}) {
  const io = new Server(server, {
    ...(adapter ? { adapter } : {}),
    transports: ['websocket'],
    cors: { origin: corsOrigin, methods: ['GET', 'POST'] },
    maxHttpBufferSize: 16 * 1024,
    // CORS alone does not restrict WebSocket upgrades.
    allowRequest: (req, callback) => callback(null, isOriginAllowed(req.headers.origin)),
  });
  const deliverLocal = async (message) => {
    const room = String(message.todoId).toLowerCase();
    const listeners = [...io.of('/').sockets.values()].filter((socket) => socket.rooms.has(room));
    await Promise.all(listeners.map(async (listener) => {
      try {
        await connectDatabase();
        const actor = await authenticateToken(listener.handshake.auth.token);
        await requireTodoAccess(actor, room);
        listener.emit('receive_message', message);
      } catch (error) {
        await listener.leave(room);
        if (publicError(error).status === 401) listener.disconnect(true);
      }
    }));
  };
  // Only other trusted server instances can emit this namespace event.
  // Each instance authorizes its own listeners; bearer tokens never cross the adapter.
  if (distributed) io.on('chat:deliver', (message) => {
    void deliverLocal(message).catch((error) => console.error(error));
  });
  io.use(async (socket, next) => {
    try {
      await connectDatabase();
      const token = socket.handshake.auth?.token;
      if (typeof token !== 'string') throw new AppError(401, 'Token required', 'UNAUTHENTICATED');
      socket.data.user = await authenticateToken(token);
      next();
    } catch (error) {
      const result = publicError(error);
      const failure = new Error(result.message);
      failure.data = result;
      next(failure);
    }
  });
  io.on('connection', (socket) => {
    let windowStart = Date.now();
    let events = 0;
    const expiryTimer = setTimeout(() => socket.disconnect(true), Math.min(socket.data.user.tokenExpiresAt - Date.now(), 2147483647));
    expiryTimer.unref();
    socket.on('disconnect', () => clearTimeout(expiryTimer));

    const handle = (schema, action) => async (payload, ack) => {
      const respond = typeof ack === 'function' ? ack : (result) => { if (!result.ok) socket.emit('chat_error', result.error); };
      try {
        if (Date.now() - windowStart >= 60000) { windowStart = Date.now(); events = 0; }
        if (++events > 60) throw new AppError(429, 'Too many chat events', 'RATE_LIMITED');
        if (Date.now() >= socket.data.user.tokenExpiresAt) throw new AppError(401, 'Token expired', 'UNAUTHENTICATED');
        const input = schema.parse(payload);
        await connectDatabase();
        // Revalidate user and token on every event, not just the handshake.
        socket.data.user = await authenticateToken(socket.handshake.auth.token);
        const data = await action(input);
        respond({ ok: true, data });
      } catch (error) {
        const result = publicError(error);
        if (result.status === 500) console.error(error);
        respond({ ok: false, error: result });
        if (result.status === 401) socket.disconnect(true);
      }
    };

    socket.on('join_room', handle(joinPayload, async ({ todoId }) => {
      await requireTodoAccess(socket.data.user, todoId);
      const room = todoId.toLowerCase();
      if (!socket.rooms.has(room) && socket.rooms.size > 100) throw new AppError(429, 'Room limit reached', 'RATE_LIMITED');
      await socket.join(room);
      return { todoId: room };
    }));
    socket.on('leave_room', handle(joinPayload, async ({ todoId }) => {
      await socket.leave(todoId.toLowerCase());
      return { todoId: todoId.toLowerCase() };
    }));
    socket.on('send_message', handle(messagePayload, async (input) => {
      const room = input.todoId.toLowerCase();
      if (!socket.rooms.has(room)) throw new AppError(403, 'Join the room before sending', 'FORBIDDEN');
      const message = await service.send(socket.data.user, input);
      const payload = message.toJSON();
      // Mongo adapter delivers to other instances; this instance handles local sockets.
      if (distributed) io.serverSideEmit('chat:deliver', payload);
      await deliverLocal(payload);
      return message;
    }));
  });
  return io;
}
