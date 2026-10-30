import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { routes } from '../App.jsx';
import { mockApi, renderRoutes, testUser } from './utils.jsx';
import { toEditorState, toPayload, completeness } from '../features/resumes/resumeModel.js';

const doc = {
  _id: 'r1',
  title: 'My Resume',
  template: 'classic',
  revision: 3,
  updatedAt: '2026-10-01T10:00:00Z',
  personal: { fullName: 'Aarav Sharma', email: 'aarav@example.com' },
  summary: '',
  education: [],
  experience: [{ _id: 'e1', role: 'Intern', organization: 'Acme', bullets: ['Built an API'] }],
  projects: [],
  skills: { technical: ['Python'], interpersonal: [] },
  certifications: [],
  achievements: [],
  links: [],
};

const authed = { 'GET /api/auth/me': () => [200, { user: testUser }] };

describe('resume model helpers', () => {
  it('drops client keys and empty bullets from the payload', () => {
    const state = toEditorState(doc);
    state.experience[0].bullets.push('   ');
    const payload = toPayload(state, 3);
    expect(payload.revision).toBe(3);
    expect(payload.experience[0]._key).toBeUndefined();
    expect(payload.experience[0]._id).toBe('e1');
    expect(payload.experience[0].bullets).toEqual(['Built an API']);
  });
  it('reports section completeness from real content', () => {
    expect(completeness(toEditorState(doc))).toMatchObject({ filled: 3, total: 6 });
  });
});

describe('ResumeEditorPage', () => {
  it('loads, live-previews edits, validates and saves with the current revision', async () => {
    const { calls } = mockApi({
      ...authed,
      'GET /api/resumes/r1': () => [200, { resume: doc }],
      'PUT /api/resumes/r1': ({ body }) => [200, { resume: { ...doc, ...body, revision: body.revision + 1, updatedAt: '2026-10-01T11:00:00Z' } }],
    });
    renderRoutes(routes, '/app/resumes/r1');
    const user = userEvent.setup();

    const name = await screen.findByLabelText('Full name');
    expect(name).toHaveValue('Aarav Sharma');
    const preview = screen.getByRole('article', { name: /resume preview/i });
    expect(within(preview).getByText('Aarav Sharma')).toBeInTheDocument();

    await user.clear(name);
    await user.type(name, 'Aarav K Sharma');
    expect(within(preview).getByText('Aarav K Sharma')).toBeInTheDocument();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

    // Inline validation blocks saving an invalid email.
    const email = screen.getByLabelText('Email');
    await user.clear(email);
    await user.type(email, 'not-an-email');
    expect(screen.getByText('Enter a valid email address')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);

    await user.clear(email);
    await user.type(email, 'aarav@example.com');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(screen.getByText('All changes saved')).toBeInTheDocument());
    const put = calls.find((c) => c.method === 'PUT');
    expect(put.body.revision).toBe(3);
    expect(put.body.personal.fullName).toBe('Aarav K Sharma');
  }, 15000); // character-by-character typing is slow under jsdom

  it('adds and removes repeatable entries', async () => {
    mockApi({ ...authed, 'GET /api/resumes/r1': () => [200, { resume: doc }] });
    renderRoutes(routes, '/app/resumes/r1');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /^projects/i }));
    await user.click(screen.getByRole('button', { name: /add project/i }));
    await user.type(screen.getByLabelText('Project name'), 'Weather App');
    const preview = screen.getByRole('article', { name: /resume preview/i });
    expect(within(preview).getByText('Weather App')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /remove weather app/i }));
    expect(within(preview).queryByText('Weather App')).not.toBeInTheDocument();
  }, 15000);

  it('explains a stale-revision conflict instead of overwriting', async () => {
    mockApi({
      ...authed,
      'GET /api/resumes/r1': () => [200, { resume: doc }],
      'PUT /api/resumes/r1': () => [409, { error: { code: 'stale_revision', message: 'Changed elsewhere' } }],
    });
    renderRoutes(routes, '/app/resumes/r1');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Headline'), 'Student');
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    expect(await screen.findByRole('dialog', { name: /changed somewhere else/i })).toBeInTheDocument();
  });

  it('shows a retryable error when the resume cannot be loaded', async () => {
    mockApi({ ...authed, 'GET /api/resumes/r1': () => [404, { error: { code: 'not_found', message: 'Resume not found.' } }] });
    renderRoutes(routes, '/app/resumes/r1');
    expect(await screen.findByText('Resume not found.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});
