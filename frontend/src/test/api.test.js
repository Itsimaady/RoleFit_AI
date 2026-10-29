import { describe, expect, it, vi } from 'vitest';
import { ApiError, api, fieldErrors, onUnauthorized } from '../lib/api.js';
import { mockApi } from './utils.jsx';

describe('API client error handling', () => {
  it('turns a network failure into a friendly ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));
    await expect(api.get('/api/resumes')).rejects.toMatchObject({ name: 'ApiError', code: 'network_error', status: 0 });
  });

  it('exposes server error codes, messages and field details', async () => {
    mockApi({ 'POST /api/resumes': () => [400, { error: { code: 'validation_error', message: 'Please check the highlighted fields.', details: [{ path: 'title', message: 'Required' }] } }] });
    const err = await api.post('/api/resumes', {}).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(fieldErrors(err)).toEqual({ title: 'Required' });
  });

  it('notifies listeners when the session has ended (401)', async () => {
    mockApi({ 'GET /api/dashboard': () => [401, { error: { code: 'session_expired', message: 'Your session has expired.' } }] });
    const listener = vi.fn();
    const off = onUnauthorized(listener);
    await api.get('/api/dashboard').catch(() => {});
    off();
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ code: 'session_expired' }));
  });

  it('refreshes the CSRF token once and retries on csrf_failed', async () => {
    let attempts = 0;
    const { calls } = mockApi({
      'POST /api/resumes': () => (++attempts === 1 ? [403, { error: { code: 'csrf_failed', message: 'bad token' } }] : [201, { resume: { _id: 'r1' } }]),
    });
    const res = await api.post('/api/resumes', { title: 'x' });
    expect(res.resume._id).toBe('r1');
    expect(attempts).toBe(2);
    expect(calls.filter((c) => c.path === '/api/auth/csrf').length).toBeGreaterThanOrEqual(1);
  });

  it('uses a generic message for 5xx without a body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('oops', { status: 502 })));
    await expect(api.get('/api/x')).rejects.toMatchObject({ status: 502, message: expect.stringMatching(/server had a problem/) });
  });
});
