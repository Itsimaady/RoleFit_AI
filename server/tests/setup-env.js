// Loaded with `node --import` before any test so config sees the test environment.
process.env.NODE_ENV = 'test';
process.env.AI_SERVICE_TOKEN = 'test-internal-token';
process.env.CLIENT_ORIGINS = 'http://localhost:5173';
