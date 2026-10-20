import { createRuntime } from '../src/runtime.js';

// One runtime/pool per warm function instance. Vercel owns the listening socket.
const { server } = await createRuntime({ distributed: true });
export default server;
