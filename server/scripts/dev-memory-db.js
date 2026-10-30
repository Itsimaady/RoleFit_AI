// Development helper for machines WITHOUT MongoDB installed.
// Starts a real mongod binary (downloaded by mongodb-memory-server) and then the API.
//   npm run dev:localdb   -> data persists in server/.mongo-data across restarts
//   npm run dev:memory    -> throwaway database, wiped on exit
// For production or long-term use, install MongoDB Community Server or use Atlas
// and run `npm run dev` / `npm start` with MONGODB_URI.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';

const persist = process.argv.includes('--persist');
const here = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(here, '..', '.mongo-data');
if (persist) fs.mkdirSync(dbPath, { recursive: true });

const mongod = await MongoMemoryServer.create({
  instance: persist ? { dbPath, storageEngine: 'wiredTiger', port: Number(process.env.LOCAL_MONGO_PORT || 27018) } : {},
});
process.env.MONGODB_URI = mongod.getUri('rolefit');
console.warn(
  persist
    ? `[dev:localdb] Local mongod at ${mongod.getUri()} storing data in ${dbPath}`
    : '[dev:memory] Using a TEMPORARY in-memory MongoDB. Data will be lost when this process stops.',
);

const { startServer } = await import('../src/server.js');
const server = await startServer({ mongoUri: process.env.MONGODB_URI });
const { address, port } = server.address();
console.log(`[dev] RoleFit AI API listening on http://${address}:${port}`);

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  server.close();
  const mongoose = (await import('mongoose')).default;
  await mongoose.disconnect().catch(() => {});
  // Keep files on disk when persisting; only wipe the temporary database.
  await mongod.stop({ doCleanup: !persist, force: false });
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
