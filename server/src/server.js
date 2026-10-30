import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { config } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/db.js';
import { createApp } from './app.js';
import { attachLiveRelay } from './services/liveRelay.js';

export async function startServer({ mongoUri = config.mongoUri, port = config.port, host = config.host } = {}) {
  await connectDatabase(mongoUri);
  const app = createApp();
  const server = http.createServer(app);
  attachLiveRelay(server);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  return server;
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  try {
    const server = await startServer();
    const { port, address } = server.address();
    console.log(`[server] RoleFit AI API listening on http://${address}:${port}`);
    console.log(`[server] Allowed client origins: ${config.clientOrigins.join(', ')}`);
    console.log(`[server] AI service: ${config.aiService.url}${config.aiService.token ? ' (token set)' : ' (no token)'}`);

    const shutdown = async (signal) => {
      console.log(`[server] ${signal} received, shutting down`);
      server.close();
      await disconnectDatabase().catch(() => {});
      process.exit(0);
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (err) {
    console.error('[server] Failed to start:', err.message);
    process.exit(1);
  }
}
