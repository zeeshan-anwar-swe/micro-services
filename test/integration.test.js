import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import request from 'supertest';
import { io as connectSocket } from 'socket.io-client';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import jwt from 'jsonwebtoken';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'integration-test-secret-with-at-least-32-characters';
process.env.BCRYPT_ROUNDS = '10';
process.env.CORS_ORIGINS = '*';
process.env.VERCEL = '1';
const localMongo = fileURLToPath(new URL('../.cache/mongod.exe', import.meta.url));
if (process.platform === 'win32' && existsSync(localMongo)) process.env.MONGOMS_SYSTEM_BINARY ??= localMongo;

let mongo, server, io, api, models, authenticateToken, baseUrl;
let createRuntime, secondRuntime, secondBaseUrl;
const sockets = [];
const actors = {};
let todoId;

before(async () => {
  // Set TEST_MONGODB_URI to an isolated real test database to skip binary download.
  // Tests clear collections: never point this at production or a development DB.
  if (process.env.TEST_MONGODB_URI) process.env.MONGODB_URI = process.env.TEST_MONGODB_URI;
  else {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    process.env.MONGODB_URI = mongo.getUri('todo_integration_test');
  }
  const [{ connectDatabase }, runtime, modelExports, auth] = await Promise.all([
    import('../src/config/database.js'), import('../src/runtime.js'),
    import('../src/models/index.js'), import('../src/modules/auth/auth.service.js'),
  ]);
  models = modelExports;
  authenticateToken = auth.authenticateToken;
  createRuntime = runtime.createRuntime;
  await connectDatabase();
  await Promise.all(Object.values(models).map((model) => model.deleteMany({})));
  const primary = await createRuntime({ distributed: true });
  ({ server, io } = primary);
  assert.equal(server.listening, false, 'Runtime construction must not open a port');
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  api = request(server);
  secondRuntime = await createRuntime({ distributed: true });
  secondRuntime.server.listen(0, '127.0.0.1');
  await once(secondRuntime.server, 'listening');
  secondBaseUrl = `http://127.0.0.1:${secondRuntime.server.address().port}`;
}, { timeout: 180000 });

after(async () => {
  for (const socket of sockets) socket.disconnect();
  if (secondRuntime) await new Promise((resolve) => secondRuntime.io.close(resolve));
  if (io) await new Promise((resolve) => io.close(resolve));
  else if (server?.listening) await new Promise((resolve) => server.close(resolve));
  const mongoose = (await import('mongoose')).default;
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});

function as(actor, method, path) { return api[method](path).auth(actors[actor].token, { type: 'bearer' }); }

async function socketFor(actor, url = baseUrl) {
  const socket = connectSocket(url, {
    auth: { token: actors[actor].token }, transports: ['websocket'], reconnection: false, forceNew: true,
  });
  sockets.push(socket);
  await Promise.race([
    once(socket, 'connect'),
    once(socket, 'connect_error').then(([error]) => { throw error; }),
    new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Connection timed out')), 5000); timer.unref(); }),
  ]);
  return socket;
}
const emit = (socket, event, payload) => socket.timeout(5000).emitWithAck(event, payload);
const eventWithin = (socket, event) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { socket.off(event, listener); reject(new Error(`Missing ${event}`)); }, 5000);
  function listener(data) { clearTimeout(timer); resolve(data); }
  socket.once(event, listener);
});

test('any browser origin can preflight Bearer requests and public API metadata is available', async () => {
  for (const origin of ['https://web.example.com', 'https://another-client.example.org']) {
    const response = await api.options('/api/v1/todos').set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,content-type').expect(204);
    assert.equal(response.headers['access-control-allow-origin'], '*');
    assert.match(response.headers['access-control-allow-headers'], /Authorization/);
    assert.equal(response.headers['access-control-allow-credentials'], undefined);
    const protectedResponse = await api.get('/api/v1/todos').set('Origin', origin).expect(401);
    assert.equal(protectedResponse.headers['access-control-allow-origin'], '*');
  }
  const root = await api.get('/').expect(200);
  assert.equal(root.body.api, '/api/v1');
  assert.equal(root.headers['cache-control'], 'no-store');
  await api.get('/health').expect(200);
  await api.get('/socket.io/?EIO=4&transport=polling').expect(400);
});

test('MongoDB connection initialization is shared and rate counters are atomic across instances', async () => {
  const { connectDatabase } = await import('../src/config/database.js');
  assert.equal(connectDatabase(), connectDatabase());
  const { MongoRateLimitStore, createRateLimiter } = await import('../src/common/rate-limit.js');
  const first = new MongoRateLimitStore('atomic-test');
  const second = new MongoRateLimitStore('atomic-test');
  first.init({ windowMs: 3600000 });
  second.init({ windowMs: 3600000 });
  const hits = await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? first : second).increment('test-client')));
  assert.deepEqual(hits.map((result) => result.totalHits).sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i + 1));
  await first.resetKey('test-client');
  assert.equal((await second.increment('test-client')).totalHits, 1);

  const express = (await import('express')).default;
  const appA = express();
  const appB = express();
  for (const app of [appA, appB]) {
    app.use(createRateLimiter('shared-limit-test', { windowMs: 3600000, limit: 2 }));
    app.get('/', (_req, res) => res.json({ ok: true }));
  }
  await request(appA).get('/').expect(200);
  await request(appB).get('/').expect(200);
  await request(appA).get('/').expect(429);
});

test('Vercel entry exports an HTTP server without binding a port and serves the existing paths', async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import http from 'node:http';
    import request from 'supertest';
    const { default: server } = await import('./api/index.js');
    assert.ok(server instanceof http.Server);
    assert.equal(server.listening, false);
    await request(server).get('/health').expect(200);
    await request(server).get('/api/v1/auth/me').expect(401);
    await request(server).options('/api/v1/todos')
      .set('Origin', 'https://independent-app.example')
      .set('Access-Control-Request-Method', 'POST').expect(204);
    console.log('entry-ok');
    process.exit(0);
  `], { cwd: fileURLToPath(new URL('..', import.meta.url)), env: process.env, timeout: 20000 });
  assert.match(stdout, /entry-ok/);
});

test('registration bootstraps isolated tenants and never returns password hashes', async () => {
  for (const actor of ['alice', 'bob', 'eve']) {
    const result = await api.post('/api/v1/auth/register').send({
      email: `${actor}@example.com`, password: 'strong-password-123', name: actor, tenantId: `tenant-${actor}`,
    }).expect(201);
    actors[actor] = result.body.data;
    assert.equal(actors[actor].user.passwordHash, undefined);
    const claims = jwt.decode(actors[actor].token);
    assert.equal(claims.userId, actors[actor].user._id);
    assert.equal(claims.tenantId, `tenant-${actor}`);
    assert.equal(claims.role, 'owner');
  }
  await api.post('/api/v1/auth/register').send({
    email: 'intruder@example.com', password: 'strong-password-123', name: 'Intruder', tenantId: 'tenant-alice',
  }).expect(409);
  assert.equal(await models.User.countDocuments({ tenantId: 'tenant-alice' }), 1);
  await api.post('/api/v1/auth/register').send({
    email: 'alice@example.com', password: 'strong-password-123', name: 'Duplicate', tenantId: 'unused-tenant',
  }).expect(409);
  assert.equal(await models.Tenant.countDocuments({ tenantId: 'unused-tenant' }), 0);
});

test('login, profile, token validation, and strict payload validation', async () => {
  const login = await api.post('/api/v1/auth/login').send({ email: 'ALICE@example.com', password: 'strong-password-123' }).expect(200);
  assert.equal(login.body.data.user.passwordHash, undefined);
  await api.post('/api/v1/auth/login').send({ email: 'alice@example.com', password: 'wrong-password' }).expect(401);
  await api.get('/api/v1/auth/me').expect(401);
  await api.get('/api/v1/auth/me').auth('invalid', { type: 'bearer' }).expect(401);
  const profile = await as('alice', 'get', '/api/v1/auth/me').expect(200);
  assert.equal(profile.body.data.email, 'alice@example.com');
  assert.equal(profile.body.data.passwordHash, undefined);
  await api.post('/api/v1/auth/register').send({ email: 'bad@example.com', password: '12345678', name: 'Bad', tenantId: 'new-tenant', role: 'owner' }).expect(400);
  await api.post('/api/v1/auth/register').send({ email: { $ne: null }, password: '12345678', name: 'Bad', tenantId: 'new-tenant' }).expect(400);
  await api.post('/api/v1/auth/register').send({ email: 'bad@example.com', password: '😀'.repeat(30), name: 'Bad', tenantId: 'new-tenant' }).expect(400);
  await api.post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{').expect(400);
});

test('portable client consumes authentication, Todo CRUD, and structured errors', async () => {
  const { createTodoClient } = await import('../examples/client.js');
  let token;
  const client = createTodoClient(`${baseUrl}/`, () => token);
  const login = await client.login({ email: 'alice@example.com', password: 'strong-password-123' });
  token = login.data.token;
  assert.equal((await client.me()).data.email, 'alice@example.com');
  const created = await client.createTodo({ title: 'Portable API client' });
  const id = created.data._id;
  assert.equal((await client.todo(id)).data.title, 'Portable API client');
  assert.equal((await client.updateTodo(id, { status: 'completed' })).data.status, 'completed');
  assert.ok((await client.todos({ limit: 10 })).data.some((todo) => todo._id === id));
  assert.equal(await client.deleteTodo(id), null);
  await assert.rejects(client.todo(id), { status: 404, code: 'NOT_FOUND' });
  token = 'invalid-token';
  await assert.rejects(client.me(), { status: 401, code: 'UNAUTHENTICATED' });
});

test('Todo CRUD is tenant scoped and rejects assignment of ownership fields', async () => {
  const created = await as('alice', 'post', '/api/v1/todos').send({ title: 'Plan release', description: 'Collaborate', dueDate: '2026-12-01T10:00:00Z' }).expect(201);
  todoId = created.body.data._id;
  assert.equal(created.body.data.tenantId, 'tenant-alice');
  assert.equal(created.body.data.ownerId, actors.alice.user._id);
  await as('alice', 'post', '/api/v1/todos').send({ title: 'Spoofed', tenantId: 'tenant-bob' }).expect(400);
  await as('alice', 'put', `/api/v1/todos/${todoId}`).send({ ownerId: actors.bob.user._id }).expect(400);
  for (const actor of ['bob', 'eve']) {
    const list = await as(actor, 'get', '/api/v1/todos').expect(200);
    assert.deepEqual(list.body.data, []);
    await as(actor, 'get', `/api/v1/todos/${todoId}`).expect(404);
    await as(actor, 'put', `/api/v1/todos/${todoId}`).send({ title: 'Hijacked' }).expect(404);
    await as(actor, 'delete', `/api/v1/todos/${todoId}`).expect(404);
    await as(actor, 'get', `/api/v1/chat/history/${todoId}`).expect(404);
  }
  await as('alice', 'get', '/api/v1/todos/not-an-id').expect(400);
  await as('alice', 'get', '/api/v1/todos?limit=1000').expect(400);
  await as('alice', 'get', '/api/v1/todos?tenantId=tenant-bob').expect(400);
  await as('alice', 'put', `/api/v1/todos/${todoId}`).send({}).expect(400);
  await as('alice', 'put', `/api/v1/todos/${todoId}`).send({ status: 'unknown' }).expect(400);
  await as('alice', 'put', `/api/v1/todos/${todoId}`).send({ dueDate: 'not-a-date' }).expect(400);
  const updated = await as('alice', 'put', `/api/v1/todos/${todoId}`).send({ status: 'in_progress' }).expect(200);
  assert.equal(updated.body.data.status, 'in_progress');
});

test('sharing grants explicit view/edit rights without expanding tenant lists', async () => {
  await as('eve', 'post', '/api/v1/shares').send({ todoId, recipientEmail: 'bob@example.com', permission: 'edit' }).expect(404);
  await as('alice', 'post', '/api/v1/shares').send({ todoId, recipientEmail: 'missing@example.com', permission: 'view' }).expect(404);
  await as('alice', 'post', '/api/v1/shares').send({ todoId, recipientEmail: 'bob@example.com', permission: 'view' }).expect(200);
  await as('bob', 'get', `/api/v1/todos/${todoId}`).expect(200);
  await as('bob', 'put', `/api/v1/todos/${todoId}`).send({ title: 'Blocked' }).expect(403);
  await as('bob', 'delete', `/api/v1/todos/${todoId}`).expect(404);
  await as('bob', 'post', '/api/v1/shares').send({ todoId, recipientEmail: 'eve@example.com', permission: 'edit' }).expect(404);
  const shared = await as('bob', 'get', '/api/v1/shares/shared-with-me').expect(200);
  assert.equal(shared.body.data[0].todo._id, todoId);
  assert.equal(shared.body.data[0].permission, 'view');
  assert.equal(shared.body.data[0].todo.deletedAt, undefined);
  assert.deepEqual((await as('bob', 'get', '/api/v1/todos').expect(200)).body.data, []);
  await as('alice', 'post', '/api/v1/shares').send({ todoId, recipientEmail: 'bob@example.com', permission: 'edit' }).expect(200);
  assert.equal(await models.Share.countDocuments({ todoId }), 1);
  const updated = await as('bob', 'put', `/api/v1/todos/${todoId}`).send({ title: 'Edited by Bob' }).expect(200);
  assert.equal(updated.body.data.title, 'Edited by Bob');
});

test('socket handshake rejects missing, forged, and expired tokens', async () => {
  for (const token of [undefined, 'forged', jwt.sign({ userId: actors.alice.user._id, tenantId: 'tenant-alice', role: 'owner' }, process.env.JWT_SECRET, { algorithm: 'HS256', issuer: 'todo-api', audience: 'todo-client', expiresIn: -1 })]) {
    const socket = connectSocket(baseUrl, { auth: { token }, transports: ['websocket'], reconnection: false, forceNew: true });
    sockets.push(socket);
    const [error] = await once(socket, 'connect_error');
    assert.equal(error.data.status, 401);
    socket.disconnect();
  }
  const spoof = jwt.sign({ userId: actors.alice.user._id, tenantId: 'tenant-bob', role: 'owner' }, process.env.JWT_SECRET, { issuer: 'todo-api', audience: 'todo-client', expiresIn: '1h' });
  await assert.rejects(authenticateToken(spoof), { status: 401 });
});

test('chat persists messages, isolates rooms, and authorizes each event', async () => {
  // View collaborators are intentionally allowed to chat.
  await as('alice', 'post', '/api/v1/shares').send({ todoId, recipientEmail: 'bob@example.com', permission: 'view' }).expect(200);
  const alice = await socketFor('alice');
  const bob = await socketFor('bob');
  const eve = await socketFor('eve');
  assert.equal((await emit(eve, 'join_room', { todoId })).error.status, 404);
  assert.equal((await emit(bob, 'send_message', { todoId, content: 'Not joined yet' })).error.status, 403);
  assert.equal((await emit(alice, 'join_room', { todoId: todoId.toUpperCase() })).ok, true);
  assert.equal((await emit(bob, 'join_room', { todoId })).ok, true);
  assert.equal((await emit(bob, 'send_message', { todoId, content: ' ' })).error.status, 400);
  let leaked = false;
  eve.on('receive_message', () => { leaked = true; });
  const deliveredAlice = eventWithin(alice, 'receive_message');
  const deliveredBob = eventWithin(bob, 'receive_message');
  const ack = await emit(bob, 'send_message', { todoId, content: 'Hello Alice' });
  assert.equal(ack.ok, true);
  const [first, second] = await Promise.all([deliveredAlice, deliveredBob]);
  assert.equal(first._id, second._id);
  assert.equal(first.senderId, actors.bob.user._id);
  assert.equal(first.tenantId, 'tenant-alice');
  assert.equal(await models.Message.countDocuments({ todoId }), 1);
  assert.equal(leaked, false);
  const history = await as('bob', 'get', `/api/v1/chat/history/${todoId}`).expect(200);
  assert.equal(history.body.data[0].content, 'Hello Alice');
  // Simulate revocation at the data layer: stale room membership cannot send/receive.
  await models.Share.deleteOne({ todoId, recipientId: actors.bob.user._id });
  assert.equal((await emit(bob, 'send_message', { todoId, content: 'Blocked after revocation' })).error.status, 404);
  let staleDelivery = false;
  bob.on('receive_message', () => { staleDelivery = true; });
  assert.equal((await emit(alice, 'send_message', { todoId, content: 'Owner only' })).ok, true);
  assert.equal(staleDelivery, false);
  assert.equal(io.sockets.sockets.get(bob.id).rooms.has(todoId), false);
  await as('bob', 'get', `/api/v1/chat/history/${todoId}`).expect(404);
  for (const socket of [alice, bob, eve]) socket.disconnect();
});

test('deleted Todos block all related access and evict existing room members', async () => {
  await as('alice', 'post', '/api/v1/shares').send({ todoId, recipientEmail: 'bob@example.com', permission: 'view' }).expect(200);
  const alice = await socketFor('alice');
  await emit(alice, 'join_room', { todoId });
  await as('alice', 'delete', `/api/v1/todos/${todoId}`).expect(204);
  assert.equal(io.sockets.sockets.get(alice.id).rooms.has(todoId), false);
  for (const actor of ['alice', 'bob']) {
    await as(actor, 'get', `/api/v1/todos/${todoId}`).expect(404);
    await as(actor, 'get', `/api/v1/chat/history/${todoId}`).expect(404);
  }
  assert.deepEqual((await as('bob', 'get', '/api/v1/shares/shared-with-me').expect(200)).body.data, []);
  assert.deepEqual((await as('alice', 'get', '/api/v1/todos').expect(200)).body.data, []);
  assert.equal((await emit(alice, 'join_room', { todoId })).error.status, 404);
  alice.disconnect();
});

test('chat crosses instances while revocation and deletion still prevent remote access', async () => {
  const created = await as('alice', 'post', '/api/v1/todos').send({ title: 'Distributed collaboration' }).expect(201);
  const id = created.body.data._id;
  await as('alice', 'post', '/api/v1/shares').send({ todoId: id, recipientEmail: 'bob@example.com', permission: 'view' }).expect(200);
  const alice = await socketFor('alice');
  const bob = await socketFor('bob', secondBaseUrl);
  const eve = await socketFor('eve', secondBaseUrl);
  assert.equal((await emit(eve, 'join_room', { todoId: id })).error.status, 404);
  assert.equal((await emit(alice, 'join_room', { todoId: id })).ok, true);
  assert.equal((await emit(bob, 'join_room', { todoId: id })).ok, true);
  const delivered = eventWithin(bob, 'receive_message');
  assert.equal((await emit(alice, 'send_message', { todoId: id, content: 'Across Vercel instances' })).ok, true);
  assert.equal((await delivered).content, 'Across Vercel instances');
  const secondaryApi = request(secondRuntime.server);
  const history = await secondaryApi.get(`/api/v1/chat/history/${id}`).auth(actors.bob.token, { type: 'bearer' }).expect(200);
  assert.equal(history.body.data[0].content, 'Across Vercel instances');

  const eventually = async (condition) => {
    const deadline = Date.now() + 5000;
    while (!condition()) {
      assert.ok(Date.now() < deadline, 'Remote instance did not update room membership');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };
  let leaked = false;
  bob.on('receive_message', () => { leaked = true; });
  await models.Share.deleteOne({ todoId: id, recipientId: actors.bob.user._id });
  assert.equal((await emit(alice, 'send_message', { todoId: id, content: 'After revocation' })).ok, true);
  await eventually(() => !secondRuntime.io.sockets.sockets.get(bob.id).rooms.has(id));
  assert.equal(leaked, false);
  assert.equal((await emit(bob, 'join_room', { todoId: id })).error.status, 404);

  await as('alice', 'post', '/api/v1/shares').send({ todoId: id, recipientEmail: 'bob@example.com', permission: 'view' }).expect(200);
  await emit(bob, 'join_room', { todoId: id });
  await as('alice', 'delete', `/api/v1/todos/${id.toUpperCase()}`).expect(204);
  await eventually(() => !secondRuntime.io.sockets.sockets.get(bob.id).rooms.has(id));
  await secondaryApi.get(`/api/v1/chat/history/${id}`).auth(actors.bob.token, { type: 'bearer' }).expect(404);
  for (const socket of [alice, bob, eve]) socket.disconnect();
});
