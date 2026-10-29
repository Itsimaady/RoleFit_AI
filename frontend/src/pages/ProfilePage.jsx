import { useState } from 'react';
import { Button, PageHeader, TextField } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api, fieldErrors } from '../lib/api.js';
import { formatDate } from '../lib/format.js';

export function ProfilePage() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({
    fullName: user.fullName,
    headline: user.profile?.headline || '',
    targetRole: user.profile?.targetRole || '',
    location: user.profile?.location || '',
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const dirty =
    form.fullName !== user.fullName ||
    form.headline !== (user.profile?.headline || '') ||
    form.targetRole !== (user.profile?.targetRole || '') ||
    form.location !== (user.profile?.location || '');

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
      toast.success('Profile saved.');
    } catch (err) {
      setErrors(fieldErrors(err));
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <PageHeader title="Profile" description={`Member since ${formatDate(user.createdAt)}`} />
      <form className="card" onSubmit={save} noValidate>
        <div className="card-body form-grid">
          <TextField label="Full name" value={form.fullName} onChange={set('fullName')} error={errors.fullName} required className="span-2" maxLength={80} />
          <TextField label="Email" value={user.email} disabled hint="Email cannot be changed." className="span-2" />
          <TextField label="Headline" value={form.headline} onChange={set('headline')} placeholder="Final-year CSE student" maxLength={120} />
          <TextField label="Target role" value={form.targetRole} onChange={set('targetRole')} placeholder="Backend Developer" maxLength={120} />
          <TextField label="Location" value={form.location} onChange={set('location')} placeholder="Hyderabad, India" maxLength={120} className="span-2" />
        </div>
        <div className="card-footer">
          <Button type="submit" variant="primary" loading={saving} disabled={!dirty}>
            Save profile
          </Button>
        </div>
      </form>
    </div>
  );
}
