import { aiClient } from '../services/aiClient.js';

/** AI bullet rewrite: returns a suggestion only; nothing is saved until the user accepts it. */
export async function rewriteBullet(req, res) {
  const data = await aiClient.json('/api/ai/rewrite-bullet', {
    text: req.body.text,
    context: req.body.context,
    job_description: req.body.jobDescription,
  });
  res.json({ original: req.body.text, suggestion: data.suggestion, notes: data.notes || '' });
}
