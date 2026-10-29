import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { routes } from '../App.jsx';
import { mockApi, renderRoutes, testUser } from './utils.jsx';

const dashboard = {
  counts: { resumes: 2, analyses: 1, interviews: 1, completedInterviews: 1 },
  recentResumes: [{ _id: 'r1', title: 'Backend Resume', template: 'modern', updatedAt: new Date().toISOString() }],
  recentAnalyses: [{ _id: 'a1', targetRole: 'Backend Intern', resumeSnapshot: { title: 'Backend Resume' }, scores: { skillCoverage: 64 }, createdAt: new Date().toISOString() }],
  recentInterviews: [{ _id: 'i1', targetRole: 'Backend Intern', status: 'completed', report: { overall_score: 71 }, answeredCount: 12, createdAt: new Date().toISOString() }],
  interviewScores: [{ id: 'i1', targetRole: 'Backend Intern', score: 71, completedAt: new Date().toISOString() }],
  activity: [],
};

const api = {
  'GET /api/auth/me': () => [200, { user: testUser }],
  'GET /api/dashboard': () => [200, dashboard],
  'POST /api/auth/logout': () => [200, { ok: true }],
};

describe('app shell navigation', () => {
  it('opens and closes the mobile navigation drawer', async () => {
    mockApi(api);
    const { container } = renderRoutes(routes, '/app');
    const user = userEvent.setup();
    const open = await screen.findByRole('button', { name: /open navigation/i });
    expect(open).toHaveAttribute('aria-expanded', 'false');
    await user.click(open);
    expect(container.querySelector('.shell')).toHaveClass('nav-open');
    expect(open).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Escape}');
    expect(container.querySelector('.shell')).not.toHaveClass('nav-open');
  });

  it('marks the current page and closes the drawer after navigating', async () => {
    mockApi({ ...api, 'GET /api/resumes': () => [200, { items: [], total: 0, page: 1, pages: 0 }] });
    const { container, router } = renderRoutes(routes, '/app');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /open navigation/i }));
    await user.click(screen.getByRole('link', { name: /^resumes$/i }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/app/resumes'));
    expect(screen.getByRole('link', { name: /^resumes$/i })).toHaveClass('active');
    expect(container.querySelector('.shell')).not.toHaveClass('nav-open');
    expect(await screen.findByText('Create your first resume')).toBeInTheDocument();
  });

  it('renders the dashboard from API data only', async () => {
    mockApi(api);
    renderRoutes(routes, '/app');
    expect(await screen.findByText('Welcome, Test')).toBeInTheDocument();
    expect(await screen.findByText('Backend Resume')).toBeInTheDocument();
    expect(screen.getByText('71/100')).toBeInTheDocument();
    expect(screen.queryByText('Getting started')).not.toBeInTheDocument();
  });

  it('shows a retry action when the dashboard fails to load', async () => {
    mockApi({ ...api, 'GET /api/dashboard': () => [500, { error: { code: 'internal_error', message: 'Something went wrong on our side.' } }] });
    renderRoutes(routes, '/app');
    expect(await screen.findByText('Something went wrong on our side.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('signs out from the profile menu', async () => {
    const { calls } = mockApi(api);
    const { router } = renderRoutes(routes, '/app');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /test student/i }));
    await user.click(screen.getByRole('menuitem', { name: /sign out/i }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(calls.some((c) => c.path === '/api/auth/logout' && c.method === 'POST')).toBe(true);
  });
});
