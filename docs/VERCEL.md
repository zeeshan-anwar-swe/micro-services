# Deploy and consume the API on Vercel

The repository includes an exported Node HTTP server in `api/index.js`. Vercel owns its listening socket; local development still uses `npm run dev`. `vercel.json` routes `/api/v1/*`, `/socket.io/*`, `/health`, and `/` to that one function. Fluid compute must be enabled for WebSockets.

## 1. Create the database

Use a MongoDB replica set or sharded cluster, such as MongoDB Atlas. The Socket.io MongoDB adapter uses change streams to coordinate chat across function instances. A standalone MongoDB server works for local memory-mode development but cannot run distributed chat.

Create a database user with read/write access to your application's database. Configure network access so Vercel can connect, and copy your connection URI **including a database name**:

```text
mongodb+srv://USER:URL_ENCODED_PASSWORD@YOUR_CLUSTER.mongodb.net/todo_collaboration?retryWrites=true&w=majority
```

Startup creates application indexes, a TTL index on `rate_limits`, and a TTL index on `socket_events`. The user must be allowed to create indexes and open change streams. Use separate databases for production and previews so preview deployments do not modify production data or share its chat events.

## 2. Import and configure the project

1. Push the repository to your Git provider and import it into Vercel.
2. Select **Other** as the framework preset. Keep the repository root as the root directory. The committed configuration uses native Node functions, installs production dependencies with `npm ci --omit=dev`, uses an empty build command, and has no static output directory. Test-only MongoDB download tools are excluded from production installation.
3. Select Node.js 22.x or 24.x. Enable Fluid compute if it is disabled on an older project.
4. Add these environment variables for the appropriate deployment environments:

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `MONGODB_URI` | Your hosted MongoDB URI with a database name |
| `JWT_SECRET` | A random secret with at least 32 characters |
| `JWT_EXPIRES_IN` | `1h` |
| `BCRYPT_ROUNDS` | `12` |
| `CORS_ORIGINS` | `*` for browser apps on any origin, or a comma-separated allowlist |

Generate a secret locally:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Vercel always uses the MongoDB Socket.io adapter; `SOCKET_ADAPTER` is only a local development setting. Do not set `PORT` on Vercel. Keep database credentials and the JWT signing secret on the server; clients receive only their individual access tokens.

5. Deploy. Environment variable changes require redeployment. The project requests a 300-second function duration. A WebSocket reconnects when the function reaches its duration limit.
6. Ensure the production domain is accessible to your intended clients. Vercel Deployment Protection can block API calls or WebSocket handshakes before they reach JWT authentication; configure that project setting to match your access requirements. Browser CORS configuration does not bypass Deployment Protection.

For CLI deployment, run `npx vercel@latest`, configure variables through your project settings, then run `npx vercel@latest --prod`.

## 3. Check the deployment

Replace the sample hostname with your deployment URL:

```powershell
$base = 'https://your-project.vercel.app'
Invoke-RestMethod "$base/health"
Invoke-RestMethod "$base/"
```

`/health` returns `{ "status": "ok" }` when the MongoDB connection is ready. `/` provides API metadata. A startup failure will appear in Vercel function logs; check the database URI, access permissions, network access, and replica-set support first.

## 4. Consume REST from any app

The API base is `https://your-project.vercel.app/api/v1`. It works with browser apps, mobile apps, Node.js, curl, and API clients. Protected routes use `Authorization: Bearer <token>`, with no authentication cookies. CORS only governs browser access; JWT and Todo permission checks apply to every client.

```javascript
const API = 'https://your-project.vercel.app/api/v1';

const response = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'alice@example.com', password: 'your-password' }),
});
const login = await response.json();
if (!response.ok) throw new Error(login.error.message);
const token = login.data.token;

const todosResponse = await fetch(`${API}/todos`, {
  headers: { Authorization: `Bearer ${token}` },
});
const todos = await todosResponse.json();
if (!todosResponse.ok) throw new Error(todos.error.message);
console.log(todos.data);
```

For a reusable wrapper, copy `examples/client.js` into your client project:

```javascript
import { createTodoClient } from './client.js';

let accessToken;
const api = createTodoClient('https://your-project.vercel.app', () => accessToken);
const { data } = await api.login({ email: 'alice@example.com', password: 'your-password' });
accessToken = data.token;
const created = await api.createTodo({ title: 'Use the deployed API' });
console.log(created.data);
```

Use `api.register({email, password, name, tenantId})` for a new user and tenant. Token storage and the sign-in UI belong to your client application. A 401 requires signing in again; this backend does not issue refresh tokens.

`CORS_ORIGINS=*` allows public browser integration on any domain. To restrict browser origins later, use exact origins with no trailing slashes, for example `https://app.example.com,http://localhost:5173`. HTTP Authorization and Content-Type preflights are handled automatically. Do not send `credentials: 'include'`: authentication uses the Bearer header.

## 5. Consume real-time chat

Install `socket.io-client` in your client project. Use the deployment origin as the URL, `/socket.io` as the path, and **WebSocket transport directly**. HTTP long-polling is disabled to avoid instance affinity requirements.

```javascript
import { io } from 'socket.io-client';

const origin = 'https://your-project.vercel.app';
const desiredRooms = new Set([todoId]);
const seen = new Set();

function renderMessage(message) {
  if (seen.has(message._id)) return;
  seen.add(message._id);
  console.log(message);
}

const socket = io(origin, {
  path: '/socket.io',
  transports: ['websocket'],
  auth: { token },
  reconnection: true,
});

socket.on('receive_message', renderMessage);
socket.on('connect_error', (error) => console.error(error.message));
socket.on('chat_error', (error) => console.error(error));

socket.on('connect', async () => {
  try {
    for (const todoId of desiredRooms) {
      const joined = await socket.timeout(10000).emitWithAck('join_room', { todoId });
      if (!joined.ok) { console.error(joined.error); continue; }
      // Restore the latest page after every reconnect; paginate for longer gaps.
      const response = await fetch(`${origin}/api/v1/chat/history/${todoId}?limit=100`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const history = await response.json();
      if (!response.ok) throw new Error(history.error.message);
      history.data.forEach(renderMessage);
    }
  } catch (error) { console.error(error); }
});

// Call from your Send button after join_room succeeds.
async function sendMessage(todoId, content) {
  if (!socket.connected) throw new Error('Reconnect before sending');
  const result = await socket.timeout(10000).emitWithAck('send_message', { todoId, content });
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}
```

Rejoining and history recovery are required because instances and connections are temporary. The server persists messages before delivery and checks recipients' current permissions on the receiving instance. Deduplicate messages by `_id`; history and live delivery may overlap, and a timed-out acknowledgement does not prove a send failed. Only send new messages from a user action, rather than automatically sending again on each reconnect. When a JWT expires, sign in again, update `socket.auth`, and call `socket.connect()`.

Rate-limit counters also live in MongoDB, so switching function instances does not reset HTTP authentication limits. Local development ignores forwarded client-IP headers. Vercel trusts its ingress proxy, which overwrites the forwarded client IP.

References: [Vercel WebSockets](https://vercel.com/docs/functions/websockets), [Vercel rewrites](https://vercel.com/docs/routing/rewrites), [Vercel request headers](https://vercel.com/docs/headers/request-headers), [Socket.io MongoDB adapter](https://socket.io/docs/v4/mongo-adapter/).
