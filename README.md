# Multi-Tenant Todo, Collaboration & Chat API

A single-repository Express backend using JavaScript ES modules, MongoDB/Mongoose, bcrypt, JWT, and Socket.io. Routes validate inputs, controllers handle HTTP responses, services enforce business rules, and Mongoose models provide data access.

**Vercel deployment:** follow [the deployment and client integration guide](docs/VERCEL.md). REST and chat use the same deployment origin. Browser access defaults to `CORS_ORIGINS=*`; authentication and tenant checks remain required on protected endpoints. A reusable REST client is included in [examples/client.js](examples/client.js).

## Run locally

Requires Node.js 22+ and MongoDB. Docker is optional.

```powershell
npm install
Copy-Item .env.example .env
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
# Paste the generated value into JWT_SECRET in .env.
docker compose up -d
npm run dev
```

If using an existing MongoDB instance, set `MONGODB_URI` and skip Docker. The included Compose database binds to localhost and uses a persistent named volume. The default API address is `http://localhost:3000`. `npm start` runs without watch mode. `GET /health` returns 200 when MongoDB is connected and 503 otherwise. Startup awaits model indexes, including unique constraints.

## Project structure

```text
src/
  app.js                         Express application factory
  server.js                      Database, HTTP, Socket.io, shutdown
  runtime.js                     Shared local/Vercel bootstrap
  config/
    env.js                       Validated environment variables
    database.js                  MongoDB lifecycle and indexes
    cors.js                      Shared HTTP/WebSocket origin policy
    socket-adapter.js            MongoDB cross-instance chat adapter
  common/
    errors.js                    Shared HTTP/socket error mapping
    validation.js                Request validation, IDs, pagination
    rate-limit.js                Atomic MongoDB-backed HTTP limits
  models/index.js                Model registry
  modules/
    auth/
      auth.routes.js
      auth.controller.js
      auth.service.js
      auth.middleware.js
      auth.validation.js
      user.model.js
      tenant.model.js
    todos/
      todo.routes.js
      todo.controller.js
      todo.service.js
      todo.access.js             Common HTTP/socket authorization
      todo.validation.js
      todo.model.js
    shares/
      share.routes.js
      share.controller.js
      share.service.js
      share.validation.js
      share.model.js
    chat/
      chat.routes.js
      chat.controller.js
      chat.service.js
      chat.socket.js
      chat.validation.js
      message.model.js
test/integration.test.js
api/index.js                     Vercel HTTP server export
vercel.json                      Function configuration and routing
docs/VERCEL.md                   Deployment and client examples
examples/client.js               Portable fetch-based REST client
scripts/check-syntax.js
.env.example
compose.yaml
```

## Tenant and permission rules

Public registration creates a **new tenant** with its first user as `owner`. `tenantId` is a 3–64 character identifier containing lowercase letters, digits, underscores, or hyphens and starting with a letter or digit. Email addresses are globally unique and normalized to lowercase, making email-only login and sharing unambiguous.

Registration rejects an existing tenant ID with 409. An arbitrary client must never obtain membership simply by submitting another tenant's ID. Joining an existing tenant would require a separate invitation or administrator provisioning flow; this repository does not expose one. The model supports multiple users in a tenant for such an extension. Roles cannot be set through registration.

`GET /todos` queries only the authenticated user's tenant. Sharing never adds foreign records to this list. `GET /shares/shared-with-me` lists explicit cross-tenant shares. Single-item routes and chat use a common permission check:

| Action | Same tenant | Shared `view` | Shared `edit` | Unshared other tenant |
| --- | --- | --- | --- | --- |
| Read Todo / chat history | Yes | Yes | Yes | No |
| Join room / send chat | Yes | Yes | Yes | No |
| Update Todo | Yes | No | Yes | No |
| Share / delete Todo | Creator only | No | No | No |

Unauthorized item access returns 404 to avoid disclosing another tenant's records. A view recipient's attempted update returns 403. The API accepts only mutable Todo fields; clients cannot override `tenantId`, `ownerId`, timestamps, or deletion state.

A Todo is the shareable collaboration unit in this API. There is no separate list collection. Repeating `POST /shares` updates the recipient's permission without creating duplicate shares. There is no share-revocation REST endpoint in the requested API.

Deletion is soft deletion. Deleted Todos disappear from all reads and deny chat, updates, and shares; connected room members are removed. Shares and message history remain stored for a future retention/purge policy. Parent existence and visibility are checked on every related access, so retained records do not grant access.

## HTTP API

All protected requests use `Authorization: Bearer <token>`. JSON responses use `{ "data": ... }`; list responses also contain `pagination`. Errors use `{ "error": { "code": "...", "message": "...", "details": [...] } }`. Validation details appear only on validation errors. Internal failures do not expose stack traces.

| Method | Path | Body / behavior |
| --- | --- | --- |
| POST | `/api/v1/auth/register` | `{email, password, name, tenantId}` → 201 `{data: {user, token}}` |
| POST | `/api/v1/auth/login` | `{email, password}` → 200 `{data: {user, token}}` |
| GET | `/api/v1/auth/me` | Current user; excludes password hash |
| POST | `/api/v1/todos` | `{title, description?, status?, dueDate?}` → 201 |
| GET | `/api/v1/todos` | Tenant-only list |
| GET | `/api/v1/todos/:id` | Read with tenant or explicit share access |
| PUT | `/api/v1/todos/:id` | Partial update of mutable fields; at least one required |
| DELETE | `/api/v1/todos/:id` | Creator only → 204 with no body |
| POST | `/api/v1/shares` | `{todoId, recipientEmail, permission}`; create/update → 200 |
| GET | `/api/v1/shares/shared-with-me` | Shares including nested `todo` and `permission` |
| GET | `/api/v1/chat/history/:todoId` | Authorized, persisted chat history |

`status`: `pending` (default), `in_progress`, or `completed`. `permission`: `view` or `edit`. `dueDate`: ISO 8601 datetime with a timezone, or `null` to clear. Example: `2026-12-01T10:00:00Z`. Titles are 1–200 characters, descriptions up to 5,000, and chat messages 1–4,000 after trimming. Passwords require at least 8 characters and at most 72 UTF-8 bytes, matching bcrypt's input limit. Unknown body/query fields and malformed ObjectIds are rejected.

Lists support `?limit=50&offset=0` (`limit` 1–100, `offset` 0–100000). Todo/share lists sort newest first with `_id` as a stable tiebreaker. Chat pagination selects the latest messages first, then returns each page in chronological order. Increase `offset` to retrieve older pages. Offset pagination can shift if records change between requests.

### PowerShell example

```powershell
$base = 'http://localhost:3000/api/v1'
$alice = Invoke-RestMethod -Method Post -Uri "$base/auth/register" -ContentType 'application/json' -Body (@{
  email = 'alice@example.com'; password = 'strong-password-123'; name = 'Alice'; tenantId = 'alice-workspace'
} | ConvertTo-Json)
$bob = Invoke-RestMethod -Method Post -Uri "$base/auth/register" -ContentType 'application/json' -Body (@{
  email = 'bob@example.com'; password = 'strong-password-456'; name = 'Bob'; tenantId = 'bob-workspace'
} | ConvertTo-Json)
$headers = @{ Authorization = "Bearer $($alice.data.token)" }
$todo = Invoke-RestMethod -Method Post -Uri "$base/todos" -Headers $headers -ContentType 'application/json' -Body (@{
  title = 'Plan the release'; description = 'Review tasks together'; status = 'pending'
} | ConvertTo-Json)
Invoke-RestMethod -Method Post -Uri "$base/shares" -Headers $headers -ContentType 'application/json' -Body (@{
  todoId = $todo.data._id; recipientEmail = 'bob@example.com'; permission = 'edit'
} | ConvertTo-Json)
Invoke-RestMethod -Uri "$base/shares/shared-with-me" -Headers @{ Authorization = "Bearer $($bob.data.token)" }
```

## Real-time chat

Use a compatible Socket.io v4 client. The server takes a JWT from `socket.handshake.auth.token`. It verifies signature, algorithm, issuer, audience, expiry, and current database membership, then uses the same checks on every event. Expired sessions disconnect. Rooms use the canonical lowercase Todo ObjectId.

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000', {
  path: '/socket.io', transports: ['websocket'], auth: { token: jwtToken },
});
socket.on('connect_error', (error) => console.error(error.message, error.data));
socket.on('receive_message', (message) => console.log(message));
socket.on('chat_error', (error) => console.error(error));

socket.on('connect', async () => {
  // Rejoin rooms after reconnecting.
  const joined = await socket.timeout(5000).emitWithAck('join_room', { todoId });
  if (!joined.ok) return console.error(joined.error);
  // Reload GET /api/v1/chat/history/:todoId to recover messages missed while offline.
});

// From a user action, once join_room succeeds:
// const sent = await socket.timeout(10000).emitWithAck('send_message', {
//   todoId, content: 'Ready to collaborate?',
// });
// if (!sent.ok) console.error(sent.error);

// Optional: await socket.timeout(5000).emitWithAck('leave_room', { todoId });
```

`join_room`, `leave_room`, and `send_message` return `{ok: true, data}` or `{ok: false, error: {status, code, message}}` through acknowledgements. If no acknowledgement is supplied, event failures emit `chat_error`. Senders must join first. Both `view` and `edit` recipients may chat. The server ignores client-supplied sender/tenant IDs by rejecting unexpected fields.

Messages are persisted before `receive_message` delivery to authorized members of that room, including the sender. Recipient access is rechecked before each delivery, and stale members leave the room. History provides recovery after reconnects; network delivery is not exactly-once, so clients should deduplicate by message `_id` and should not blindly retry a timed-out send without checking history. No offline push or read receipts are implemented.

## Configuration and deployment

| Variable | Default / purpose |
| --- | --- |
| `NODE_ENV` | `development`; also accepts `test`, `production` |
| `PORT` | `3000` |
| `MONGODB_URI` | Required MongoDB connection URI |
| `JWT_SECRET` | Required random secret, at least 32 characters |
| `JWT_EXPIRES_IN` | `1h`; positive duration such as `30m`, maximum `7d` |
| `BCRYPT_ROUNDS` | `12`; accepted range 10–15 |
| `CORS_ORIGINS` | `*` by default; or comma-separated exact browser origins |
| `SOCKET_ADAPTER` | Local `memory` default; `mongo` enables distributed chat. Vercel always uses `mongo`. |

JWTs contain `userId`, `tenantId`, and `role`; `req.user` includes these plus token expiry. Password hashes are never serialized. Authentication routes allow 30 attempts per 15-minute fixed window per IP, HTTP allows 300 requests per minute per IP, and sockets allow 60 handled chat events per minute per connection with a 100-room maximum. HTTP JSON is limited to 32 KiB and socket packets to 16 KiB. Browser origins may be unrestricted with `*` or allowlisted for HTTP CORS and WebSocket upgrades. Non-browser clients still require authentication. Only WebSocket transport is accepted for Socket.io.

The Vercel entry point exports the HTTP server without opening a listening port and reuses a bounded MongoDB connection pool on warm instances. It uses MongoDB change streams for cross-instance chat; deploy with Atlas or another replica set/sharded cluster. HTTP rate limits use atomic MongoDB counters with TTL cleanup on both Vercel and local development. Chat adapter events expire after one hour. No Redis service is required.

Local development uses in-memory rooms unless `SOCKET_ADAPTER=mongo` is configured. Express trusts Vercel's ingress proxy when `VERCEL=1`; local requests ignore forwarded client IPs. For other hosting providers configure proxy trust for that deployment. Use TLS and a private/authenticated MongoDB service when deploying. MongoDB's unique indexes enforce email, tenant, and share constraints; review index creation as a deployment migration for large existing databases.

Registration uses a unique tenant reservation and compensating cleanup when user creation fails, allowing standalone MongoDB. A process crash between reservation and user insertion can leave an empty reserved tenant; reconcile such records administratively. If crash-atomic provisioning is required, use a MongoDB transaction on a replica set. Authorization and writes use separate queries; concurrent permission changes can overlap an in-flight operation. Use transactional coordination if immediate, linearizable revocation is required. There are no refresh tokens, logout/revocation lists, password reset, or email verification flows in this scope.

## Verification

```powershell
npm run check
npm test
```

Integration tests use a real ephemeral MongoDB replica set through `mongodb-memory-server`; the first run downloads a MongoDB binary unless `MONGOMS_SYSTEM_BINARY` points to an existing server executable. On Windows the tests also reuse `.cache/mongod.exe` if present. They exercise authentication, tenant isolation, share permission changes, CORS preflights, shared atomic rate limits, socket handshakes, room isolation, message persistence/history, cross-instance delivery, stale membership checks, and deletion. To use an already-running **disposable replica-set** database instead:

```powershell
$env:TEST_MONGODB_URI = 'mongodb://127.0.0.1:27017/todo_disposable_test?replicaSet=rs0'
npm test
```

The test suite clears its database collections. Do not use a development or production database for `TEST_MONGODB_URI`.

Implementation references: [Socket.io authentication middleware](https://socket.io/docs/v4/middlewares/), [Socket.io rooms](https://socket.io/docs/v4/rooms/), and [Mongoose validation and unique indexes](https://mongoosejs.com/docs/validation.html).
