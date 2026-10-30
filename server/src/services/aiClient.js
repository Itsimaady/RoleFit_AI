// Client for the internal Python AI service (FastAPI). Express is the only
// public backend; the AI service authenticates Express with a shared token.
import { config } from '../config/env.js';
import { ApiError } from '../utils/errors.js';

const UNAVAILABLE =
  'The AI service is not running or not reachable. Start it from the backend folder (see README) to use AI features. ' +
  'Resume editing, PDF export and rule-based job matching keep working without it.';

function headers(extra = {}) {
  return { ...(config.aiService.token ? { 'X-Internal-Token': config.aiService.token } : {}), ...extra };
}

async function request(path, { method = 'POST', json, body, contentType, timeoutMs = config.aiService.timeoutMs } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(`${config.aiService.url}${path}`, {
      method,
      headers: headers(json !== undefined ? { 'Content-Type': 'application/json' } : contentType ? { 'Content-Type': contentType } : {}),
      body: json !== undefined ? JSON.stringify(json) : body,
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw new ApiError(504, 'ai_service_timeout', 'The AI service took too long to respond. Please try again.');
    throw ApiError.unavailable(UNAVAILABLE, 'ai_service_unavailable');
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    let detail = '';
    try {
      const data = await response.json();
      detail = typeof data.detail === 'string' ? data.detail : data.message || '';
    } catch {
      /* non-JSON error body */
    }
    if (response.status === 401 || response.status === 403) {
      throw ApiError.unavailable('The AI service rejected this server. Check that AI_SERVICE_TOKEN matches in server/.env and backend/.env.', 'ai_service_misconfigured');
    }
    if (response.status === 503) throw ApiError.unavailable(detail || UNAVAILABLE, 'ai_not_configured');
    if (response.status >= 400 && response.status < 500) throw new ApiError(response.status === 413 ? 413 : 400, 'ai_request_rejected', detail || 'The AI service rejected the request.');
    // The AI service's own messages are written to be safe for users; prefer them.
    throw new ApiError(502, 'ai_service_error', detail || 'The AI service failed to complete the request. Please try again.');
  }
  return response;
}

export const aiClient = {
  async json(path, payload, options) {
    const res = await request(path, { json: payload, ...options });
    return res.json();
  },
  async binary(path, payload, options) {
    const res = await request(path, { json: payload, ...options });
    return Buffer.from(await res.arrayBuffer());
  },
  async forwardMultipart(path, rawBody, contentType, options) {
    const res = await request(path, { body: rawBody, contentType, ...options });
    return res.json();
  },
  async health() {
    try {
      const res = await request('/api/health', { method: 'GET', timeoutMs: 3000 });
      const data = await res.json();
      return { reachable: true, geminiConfigured: Boolean(data.gemini_live_configured), version: data.version || null };
    } catch {
      return { reachable: false, geminiConfigured: false, version: null };
    }
  },
};
