import { useState } from 'react';
import { LogOut, ShieldCheck, User } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button, PageHeader, TextField } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api, fieldErrors } from '../lib/api.js';
import { formatDate, formatDateTime, initials } from '../lib/format.js';

const fromUser = (user) => ({
  fullName: user.fullName,
  headline: user.profile?.headline || '',
  targetRole: user.profile?.targetRole || '',
  location: user.profile?.location || '',
});

export function ProfilePage() {
  const { user, setUser, sessionExpiresAt, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState(() => fromUser(user));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const initial = fromUser(user);
  const dirty = Object.keys(initial).some((k) => form[k] !== initial[k]);

  const save = async (e) => {
    e.preventDefault();
    if (form.fullName.trim().length < 2) return setErrors({ fullName: 'Full name must be at least 2 characters' });
    setSaving(true);
    setErrors({});
    try {
      const { user: updated } = await api.patch('/api/auth/me', {
        fullName: form.fullName.trim(),
        profile: { headline: form.headline.trim(), targetRole: form.targetRole.trim(), location: form.location.trim() },
      });
      setUser(updated);
      setForm(fromUser(updated));
      toast.success('Profile saved.');
    } catch (err) {
      setErrors(fieldErrors(err));
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const signOut = async () => {
    await logout().catch(() => {});
    navigate('/login');
  };

  return (
    <div className="page page-narrow">
      <PageHeader title="Profile & account" description="Your name and goals appear in the app. Resumes keep their own contact details." />

      <div className="card card-pad row" style={{ gap: 16, flexWrap: 'nowrap' }}>
        <span className="avatar" style={{ width: 52, height: 52, fontSize: 17 }} aria-hidden="true">
          {initials(user.fullName)}
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 650, fontSize: 17 }}>{user.fullName}</div>
          <div className="small muted" style={{ overflowWrap: 'anywhere' }}>
            {user.email}
          </div>
          {user.profile?.targetRole && <div className="xsmall muted">Preparing for {user.profile.targetRole}</div>}
        </div>
      </div>

      <form className="card" onSubmit={save} noValidate aria-labelledby="profile-details">
        <div className="card-header">
          <h2 id="profile-details">
            <User size={16} /> Profile details
          </h2>
          {dirty && <span className="xsmall" style={{ color: 'var(--warning)', fontWeight: 600 }}>Unsaved changes</span>}
        </div>
        <div className="card-body form-grid">
          <TextField label="Full name" value={form.fullName} onChange={set('fullName')} error={errors.fullName} required className="span-2" maxLength={80} autoComplete="name" />
          <TextField label="Headline" value={form.headline} onChange={set('headline')} placeholder="Final-year CSE student" maxLength={120} />
          <TextField label="Target role" value={form.targetRole} onChange={set('targetRole')} placeholder="Backend Developer" maxLength={120} />
          <TextField label="Location" value={form.location} onChange={set('location')} placeholder="Hyderabad, India" maxLength={120} className="span-2" />
        </div>
        <div className="card-footer">
          <Button onClick={() => setForm(initial)} disabled={!dirty || saving}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!dirty}>
            Save changes
          </Button>
        </div>
      </form>

      <section className="card" aria-labelledby="account">
        <div className="card-header">
          <h2 id="account">
            <ShieldCheck size={16} /> Account & session
          </h2>
        </div>
        <ul className="list">
          <li className="list-row">
            <div className="grow">
              <span className="title">Email</span>
              <span className="meta">Used to sign in. It cannot be changed here.</span>
            </div>
            <span className="small" style={{ overflowWrap: 'anywhere', textAlign: 'right' }}>
              {user.email}
            </span>
          </li>
          <li className="list-row">
            <div className="grow">
              <span className="title">Member since</span>
            </div>
            <span className="small">{formatDate(user.createdAt)}</span>
          </li>
          <li className="list-row">
            <div className="grow">
              <span className="title">Current session</span>
              <span className="meta">You will be asked to sign in again after this time.</span>
            </div>
            <span className="small">{sessionExpiresAt ? `Expires ${formatDateTime(sessionExpiresAt)}` : 'Active'}</span>
          </li>
        </ul>
        <div className="card-footer">
          <Button onClick={signOut}>
            <LogOut size={15} /> Sign out
          </Button>
        </div>
      </section>
    </div>
  );
}
