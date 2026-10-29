// Development helper: starts the API against a temporary in-memory MongoDB.
// Useful for demos on machines without MongoDB installed. DATA IS LOST ON EXIT.
// For persistent data, install MongoDB Community Server or use Atlas and run `npm run dev`.
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongod.getUri('rolefit');
console.warn('[dev:memory] Using a TEMPORARY in-memory MongoDB. Data will be lost when this process stops.');

const { startServer } = await import('../src/server.js');
const server = await startServer({ mongoUri: process.env.MONGODB_URI });
const { address, port } = server.address();
console.log(`[dev:memory] RoleFit AI API listening on http://${address}:${port}`);

const stop = async () => {
  server.close();
  await mongod.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
