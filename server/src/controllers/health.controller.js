import { databaseStatus } from '../config/db.js';
import { aiClient } from '../services/aiClient.js';

export function health(_req, res) {
  const database = databaseStatus();
  res.status(database.connected ? 200 : 503).json({
    status: database.connected ? 'ok' : 'degraded',
    service: 'rolefit-ai-server',
    database,
    uptimeSeconds: Math.round(process.uptime()),
  });
}

export async function aiHealth(_req, res) {
  res.json({ aiService: await aiClient.health() });
}
