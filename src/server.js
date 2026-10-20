import { env } from './config/env.js';
import { disconnectDatabase } from './config/database.js';
import { createRuntime } from './runtime.js';

let server;
let io;
let stopping = false;
async function shutdown(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => process.exit(1), 10000);
  deadline.unref();
  try {
    if (io) await new Promise((resolve) => io.close(resolve));
    else if (server?.listening) await new Promise((resolve) => server.close(resolve));
    await disconnectDatabase();
    clearTimeout(deadline);
    process.exitCode = exitCode;
  } catch (error) { console.error(error); process.exit(1); }
}

process.on('SIGINT', () => shutdown());
process.on('SIGTERM', () => shutdown());
try {
  ({ server, io } = await createRuntime());
  server.on('error', (error) => { console.error(error); void shutdown(1); });
  server.listen(env.PORT, () => console.log(`API listening on port ${env.PORT}`));
} catch (error) {
  console.error(error);
  await shutdown(1);
}
