import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { routes } from '../App.jsx';
import { mockApi, renderRoutes, testUser } from './utils.jsx';
import { validateRegistration } from '../lib/validation.js';

const anonymous = { 'GET /api/auth/me': () => [401, { error: { code: 'unauthorized', message: 'Please sign in to continue.' } }] };

describe('registration validation rules', () => {
  it('reports every invalid field', () => {
    const errors = validateRegistration({ fullName: '', email: 'bad', password: 'short', confirmPassword: 'other' });
    expect(Object.keys(errors).sort()).toEqual(['confirmPassword', 'email', 'fullName', 'password']);
    expect(errors.password).toMatch(/8 characters/);
  });
  it('accepts a valid registration', () => {
    expect(validateRegistration({ fullName: 'Ana Ray', email: 'ana@x.io', password: 'Passw0rd1', confirmPassword: 'Passw0rd1' })).toEqual({});
  });
});

describe('RegisterPage', () => {
  it('shows inline errors and does not call the API when the form is invalid', async () => {
    const { calls } = mockApi(anonymous);
    renderRoutes(routes, '/register');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /create account/i }));
    expect(screen.getByText('Full name is required')).toBeInTheDocument();
    expect(screen.getByText('Email is required')).toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/api/auth/register')).toBe(false);
  });

  it('flags mismatched passwords', async () => {
    mockApi(anonymous);
    renderRoutes(routes, '/register');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/^password/i), 'Passw0rd!23');
    await user.type(screen.getByLabelText(/confirm password/i), 'Passw0rd!24');
    await user.click(screen.getByRole('button', { name: /create account/i }));
    expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
  });

  it('registers with a CSRF header and lands on the dashboard', async () => {
    const { calls } = mockApi({
      ...anonymous,
      'POST /api/auth/register': () => [201, { user: testUser }],
      'GET /api/dashboard': () => [200, { counts: { resumes: 0, analyses: 0, interviews: 0, completedInterviews: 0 }, recentResumes: [], recentAnalyses: [], recentInterviews: [], interviewScores: [], activity: [] }],
    });
    const { router } = renderRoutes(routes, '/register');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/full name/i), 'Test Student');
    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/^password/i), 'Passw0rd!23');
    await user.type(screen.getByLabelText(/confirm password/i), 'Passw0rd!23');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/app'));
    const reg = calls.find((c) => c.path === '/api/auth/register');
    expect(reg.headers['X-CSRF-Token']).toBe('test-csrf');
    expect(reg.body.email).toBe('test@example.com');
    // New account: getting-started checklist driven by real (zero) counts.
    expect(await screen.findByText('Getting started')).toBeInTheDocument();
    expect(screen.getByText('0 of 3 done')).toBeInTheDocument();
  });

  it('shows the server message for a duplicate email', async () => {
    mockApi({
      ...anonymous,
      'POST /api/auth/register': () => [409, { error: { code: 'conflict', message: 'An account with this email already exists. Try signing in instead.' } }],
    });
    renderRoutes(routes, '/register');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/full name/i), 'Test Student');
    await user.type(screen.getByLabelText(/email/i), 'dup@example.com');
    await user.type(screen.getByLabelText(/^password/i), 'Passw0rd!23');
    await user.type(screen.getByLabelText(/confirm password/i), 'Passw0rd!23');
    await user.click(screen.getByRole('button', { name: /create account/i }));
    expect(await screen.findByText(/already exists/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /sign in instead/i })).toBeInTheDocument();
  });
});

describe('protected routes', () => {
  it('redirects anonymous users from the app to the login page', async () => {
    mockApi(anonymous);
    const { router } = renderRoutes(routes, '/app/resumes');
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
  });
});
