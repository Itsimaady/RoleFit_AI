import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { vi } from 'vitest';
import { Providers } from '../App.jsx';

const json = (status, body) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * Installs a fetch mock. `routes` maps "METHOD /path" (path without query) to
 * a handler (req) => [status, body]. Unmatched requests return 404.
 */
export function mockApi(routes) {
  const calls = [];
  const fetchMock = vi.fn(async (url, init = {}) => {
    const u = new URL(url, 'http://localhost');
    const method = init.method || 'GET';
    const body = init.body && typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    const call = { method, path: u.pathname, search: u.search, body, headers: init.headers || {} };
    calls.push(call);
    if (u.pathname === '/api/auth/csrf') return json(200, { csrfToken: 'test-csrf' });
    const handler = routes[`${method} ${u.pathname}`];
    if (!handler) return json(404, { error: { code: 'not_found', message: `No mock for ${method} ${u.pathname}` } });
    const [status, payload] = await handler(call);
    return json(status, payload);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

export const testUser = { id: 'u1', fullName: 'Test Student', email: 'test@example.com', profile: {}, createdAt: '2026-01-01T00:00:00Z' };

export function renderRoutes(routes, initialPath) {
  const router = createMemoryRouter(routes, { initialEntries: [initialPath] });
  const utils = render(
    <Providers>
      <RouterProvider router={router} />
    </Providers>,
  );
  return { ...utils, router };
}
