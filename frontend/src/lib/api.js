// Shared HTTP client: cookie session, CSRF header, consistent errors.
const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let csrfToken = null;
let csrfPromise = null;

async function getCsrfToken(force = false) {
  if (csrfToken && !force) return csrfToken;
  if (!csrfPromise) {
    csrfPromise = fetch(`${BASE}/api/auth/csrf`, { credentials: 'include' })
      .then((r) => {
        if (!r.ok) throw new Error('csrf');
        return r.json();
      })
      .then((d) => {
        csrfToken = d.csrfToken;
        return csrfToken;
      })
      .catch(() => {
        throw new ApiError(0, 'network_error', 'Cannot reach the server. Check that the API is running and try again.');
      })
      .finally(() => {
        csrfPromise = null;
      });
  }
  return csrfPromise;
}

const unauthorizedListeners = new Set();
/** Subscribe to "session ended" events (401 on an authenticated call). */
export function onUnauthorized(listener) {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

async function parseError(res) {
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* empty or non-JSON body */
  }
  const err = body?.error || {};
  const fallback =
    res.status === 429
      ? 'Too many requests. Please wait a moment and try again.'
      : res.status >= 500
        ? 'The server had a problem completing this request. Please try again.'
        : 'The request could not be completed.';
  return new ApiError(res.status, err.code || `http_${res.status}`, err.message || fallback, err.details);
}

export async function request(path, { method = 'GET', body, formData, signal, raw = false, retry = true, silent401 = false } = {}) {
  const headers = {};
  let payload;
  if (formData) payload = formData;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  if (method !== 'GET' && method !== 'HEAD') headers['X-CSRF-Token'] = await getCsrfToken();

  let res;
  try {
    res = await fetch(`${BASE}${path}`, { method, headers, body: payload, credentials: 'include', signal });
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    throw new ApiError(0, 'network_error', 'Cannot reach the server. Check your connection and that the API is running.');
  }

  if (!res.ok) {
    const error = await parseError(res);
    // CSRF cookie can rotate (e.g. after it expires): refresh once and retry.
    if (error.code === 'csrf_failed' && retry) {
      await getCsrfToken(true);
      return request(path, { method, body, formData, signal, raw, retry: false, silent401 });
    }
    if (res.status === 401 && !silent401) unauthorizedListeners.forEach((fn) => fn(error));
    throw error;
  }
  if (raw) return res;
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  get: (path, opts) => request(path, { ...opts, method: 'GET' }),
  post: (path, body, opts) => request(path, { ...opts, method: 'POST', body }),
  put: (path, body, opts) => request(path, { ...opts, method: 'PUT', body }),
  patch: (path, body, opts) => request(path, { ...opts, method: 'PATCH', body }),
  del: (path, opts) => request(path, { ...opts, method: 'DELETE' }),
  upload: (path, formData, opts) => request(path, { ...opts, method: 'POST', formData }),
};

function filenameFrom(res, fallback) {
  const header = res.headers.get('Content-Disposition') || '';
  const match = header.match(/filename="?([^";]+)"?/i);
  return match ? match[1] : fallback;
}

/** Downloads a binary response (PDF/DOCX) as a file. */
export async function download(path, fallbackName) {
  const res = await request(path, { raw: true });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filenameFrom(res, fallbackName);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { size: blob.size, type: blob.type };
}

export function websocketUrl(path) {
  const origin = BASE || window.location.origin;
  const url = new URL(path, origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

/** Maps server validation details ("personal.email") to a { path: message } object. */
export function fieldErrors(error) {
  if (!(error instanceof ApiError) || !Array.isArray(error.details)) return {};
  return Object.fromEntries(error.details.filter((d) => d.path).map((d) => [d.path, d.message]));
}
