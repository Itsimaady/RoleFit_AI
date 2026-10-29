import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { Brand } from '../components/Brand.jsx';
import { Alert, Button, PasswordField, TextField } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { fieldErrors } from '../lib/api.js';
import { passwordStrength, validateLogin, validateRegistration } from '../lib/validation.js';

function AuthLayout({ children }) {
  return (
    <div className="auth">
      <aside className="auth-aside">
        <Brand />
        <h2>Prepare for your first role with a clear, honest workflow.</h2>
        <ul>
          <li>
            <CheckCircle2 size={18} /> Build and export professional resumes
          </li>
          <li>
            <CheckCircle2 size={18} /> See exactly which job skills you already demonstrate
          </li>
          <li>
            <CheckCircle2 size={18} /> Practise live interviews tailored to the role
          </li>
        </ul>
      </aside>
      <main className="auth-main">
        <div className="auth-card">{children}</div>
      </main>
    </div>
  );
}

function useForm(initial) {
  const [values, setValues] = useState(initial);
  const [touched, setTouched] = useState({});
  const bind = (name) => ({
    name,
    value: values[name],
    onChange: (e) => setValues((v) => ({ ...v, [name]: e.target.value })),
    onBlur: () => setTouched((t) => ({ ...t, [name]: true })),
  });
  return { values, touched, setTouched, bind };
}

export function LoginPage() {
  const { login, sessionEndedReason } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { values, touched, setTouched, bind } = useForm({ email: '', password: '' });
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState('');
  const errors = validateLogin(values);
  const show = (k) => (touched[k] ? errors[k] : undefined);

  const onSubmit = async (e) => {
    e.preventDefault();
    setTouched({ email: true, password: true });
    setServerError('');
    if (Object.keys(errors).length) return;
    setSubmitting(true);
    try {
      await login({ email: values.email.trim(), password: values.password });
      navigate(location.state?.from || '/app', { replace: true });
    } catch (err) {
      setServerError(err.message);
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout>
      <div>
        <h1>Welcome back</h1>
        <p className="muted">Sign in to continue preparing.</p>
      </div>
      {sessionEndedReason && !serverError && <Alert tone="warning">{sessionEndedReason}</Alert>}
      {serverError && <Alert tone="danger">{serverError}</Alert>}
      <form onSubmit={onSubmit} noValidate>
        <TextField label="Email" type="email" autoComplete="email" error={show('email')} required {...bind('email')} />
        <PasswordField label="Password" autoComplete="current-password" error={show('password')} {...bind('password')} />
        <Button type="submit" variant="primary" size="lg" className="btn-block" loading={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
      <p className="auth-switch">
        New to RoleFit AI? <Link to="/register">Create an account</Link>
      </p>
    </AuthLayout>
  );
}

const STRENGTH_LABEL = ['', 'Weak', 'Fair', 'Good', 'Strong'];

export function RegisterPage() {
  const { register } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const { values, touched, setTouched, bind } = useForm({ fullName: '', email: '', password: '', confirmPassword: '' });
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState('');
  const [serverFields, setServerFields] = useState({});
  const errors = validateRegistration(values);
  const show = (k) => (touched[k] ? errors[k] || serverFields[k] : serverFields[k]);
  const strength = passwordStrength(values.password);

  const onSubmit = async (e) => {
    e.preventDefault();
    setTouched({ fullName: true, email: true, password: true, confirmPassword: true });
    setServerError('');
    setServerFields({});
    if (Object.keys(errors).length) return;
    setSubmitting(true);
    try {
      await register({ ...values, fullName: values.fullName.trim(), email: values.email.trim() });
      toast.success('Your account is ready. Let’s build your first resume.');
      navigate('/app', { replace: true });
    } catch (err) {
      setServerFields(fieldErrors(err));
      setServerError(err.message);
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout>
      <div>
        <h1>Create your account</h1>
        <p className="muted">Free for students. It takes less than a minute.</p>
      </div>
      {serverError && (
        <Alert tone="danger">
          {serverError}
          {serverError.includes('already exists') && (
            <>
              {' '}
              <Link to="/login">Sign in instead</Link>.
            </>
          )}
        </Alert>
      )}
      <form onSubmit={onSubmit} noValidate>
        <TextField label="Full name" autoComplete="name" error={show('fullName')} required {...bind('fullName')} />
        <TextField label="Email" type="email" autoComplete="email" error={show('email')} required {...bind('email')} />
        <PasswordField label="Password" autoComplete="new-password" error={show('password')} hint="At least 8 characters with a letter and a number." {...bind('password')}>
          {values.password && (
            <div className="row" style={{ gap: 8 }}>
              <div className="strength" data-score={strength} style={{ flex: 1 }} aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
              </div>
              <span className="small muted" aria-live="polite">
                {STRENGTH_LABEL[strength]}
              </span>
            </div>
          )}
        </PasswordField>
        <PasswordField label="Confirm password" autoComplete="new-password" error={show('confirmPassword')} {...bind('confirmPassword')} />
        <Button type="submit" variant="primary" size="lg" className="btn-block" loading={submitting}>
          {submitting ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
      <p className="auth-switch">
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
    </AuthLayout>
  );
}
