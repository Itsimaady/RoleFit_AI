import mongoose from 'mongoose';

// strictQuery drops filter keys that are not in the schema. NoSQL operator
// injection is prevented upstream: every request field is validated by zod as a
// primitive (string/number), so objects like {"$gt": ""} never reach a query.
mongoose.set('strictQuery', true);

const STATES = ['disconnected', 'connected', 'connecting', 'disconnecting'];

let lastError = null;

mongoose.connection.on('error', (err) => {
  lastError = err.message;
  console.error('[db] connection error:', err.message);
});
mongoose.connection.on('disconnected', () => {
  console.warn('[db] disconnected');
});
mongoose.connection.on('connected', () => {
  lastError = null;
});

export async function connectDatabase(uri) {
  if (!uri) {
    throw new Error('MONGODB_URI is not set. Copy server/.env.example to server/.env and configure it.');
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000, autoIndex: true });
  // Ensure unique and TTL indexes exist before accepting traffic.
  await Promise.all(Object.values(mongoose.models).map((model) => model.syncIndexes()));
  return mongoose.connection;
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}

export function databaseStatus() {
  const state = STATES[mongoose.connection.readyState] || 'unknown';
  return {
    state,
    connected: mongoose.connection.readyState === 1,
    name: mongoose.connection.readyState === 1 ? mongoose.connection.name : null,
    error: state === 'connected' ? null : lastError,
  };
}
