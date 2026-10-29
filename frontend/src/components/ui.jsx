import { useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, Eye, EyeOff, X } from 'lucide-react';

export function Spinner({ large = false, label = 'Loading' }) {
  return <span className={`spinner${large ? ' spinner-lg' : ''}`} role="status" aria-label={label} />;
}

export function PageLoader({ label = 'Loading' }) {
  return (
    <div className="page-loader">
      <Spinner large label={label} />
    </div>
  );
}

export function Button({ loading = false, children, disabled, className = '', variant, size, ...props }) {
  const classes = ['btn', variant && `btn-${variant}`, size && `btn-${size}`, className].filter(Boolean).join(' ');
  return (
    <button type="button" className={classes} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {loading && <span className="spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function Field({ label, error, hint, children, className = '', id: forcedId, required }) {
  const autoId = useId();
  const id = forcedId || autoId;
  const describedBy = [error && `${id}-error`, hint && `${id}-hint`].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`field ${className}`}>
      {label && (
        <label htmlFor={id}>
          {label}
          {required && <span aria-hidden="true"> *</span>}
        </label>
      )}
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {hint && !error && (
        <span className="field-hint" id={`${id}-hint`}>
          {hint}
        </span>
      )}
      {error && (
        <span className="field-error" id={`${id}-error`} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export function TextField({ label, error, hint, className, required, multiline = false, ...props }) {
  return (
    <Field label={label} error={error} hint={hint} className={className} required={required}>
      {(a11y) => (multiline ? <textarea className="textarea" {...a11y} {...props} /> : <input className="input" required={required} {...a11y} {...props} />)}
    </Field>
  );
}

export function PasswordField({ label, error, hint, children, ...props }) {
  const [visible, setVisible] = useState(false);
  return (
    <Field label={label} error={error} hint={hint}>
      {(a11y) => (
        <>
          <div className="password-wrap">
            <input className="input" type={visible ? 'text' : 'password'} {...a11y} {...props} />
            <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => setVisible((v) => !v)} aria-label={visible ? 'Hide password' : 'Show password'}>
              {visible ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {children}
        </>
      )}
    </Field>
  );
}

export function Badge({ tone = '', children }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Alert({ tone = 'info', title, children, icon: Icon = AlertTriangle, action }) {
  return (
    <div className={`alert alert-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon size={18} aria-hidden="true" />
      <div className="stack" style={{ gap: 4, flex: 1 }}>
        {title && <strong>{title}</strong>}
        {children && <div>{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children, action }) {
  return (
    <div className="empty">
      {Icon && (
        <div className="empty-icon">
          <Icon size={24} aria-hidden="true" />
        </div>
      )}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="empty">
      <div className="empty-icon" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
        <AlertTriangle size={24} aria-hidden="true" />
      </div>
      <h3>Something went wrong</h3>
      <p>{error?.message || 'This content could not be loaded.'}</p>
      {onRetry && (
        <Button onClick={onRetry} variant="primary">
          Try again
        </Button>
      )}
    </div>
  );
}

export function Skeleton({ height = 16, width = '100%', style }) {
  return <div className="skeleton" style={{ height, width, ...style }} aria-hidden="true" />;
}

export function SkeletonList({ rows = 3 }) {
  return (
    <div className="stack" style={{ padding: 20, gap: 14 }} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="stack" style={{ gap: 6 }}>
          <Skeleton width="45%" />
          <Skeleton width="70%" height={12} />
        </div>
      ))}
    </div>
  );
}

/** Accessible modal confirmation dialog (focus trap + Escape to cancel). */
export function ConfirmDialog({ open, title, children, confirmLabel = 'Confirm', cancelLabel = 'Cancel', tone = 'primary', loading = false, onConfirm, onCancel }) {
  const dialogRef = useRef(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    const node = dialogRef.current;
    const focusables = () => [...node.querySelectorAll('button:not([disabled]), [href], input, select, textarea')];
    focusables()[0]?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape' && !loading) onCancel?.();
      if (e.key === 'Tab') {
        const items = focusables();
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [open, loading, onCancel]);

  if (!open) return null;
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !loading && onCancel?.()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef}>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <h2 id={titleId} style={{ flex: 1 }}>
            {title}
          </h2>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={onCancel} aria-label="Close" disabled={loading}>
            <X size={16} />
          </button>
        </div>
        <div>{children}</div>
        <div className="dialog-actions">
          <Button onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={tone} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function Meter({ value, tone = '', label }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className={`meter ${tone}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v)} aria-label={label}>
      <i style={{ width: `${v}%` }} />
    </div>
  );
}

/** Circular progress for a real 0-100 value; renders "—" when the value is unknown. */
export function Ring({ value, size = 88, stroke = 8, label, sublabel, tone = 'accent' }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const known = value !== null && value !== undefined && Number.isFinite(Number(value));
  const v = known ? Math.max(0, Math.min(100, Number(value))) : 0;
  const color = { accent: 'var(--accent)', success: 'var(--success)', warning: 'var(--warning)', ai: 'var(--ai)' }[tone];
  return (
    <div className="ring" style={{ width: size, height: size }} role="img" aria-label={known ? `${label}: ${Math.round(v)}%` : `${label}: not measurable`}>
      <svg width={size} height={size} aria-hidden="true">
        <circle className="track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} />
        {known && <circle className="value" cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} />}
      </svg>
      <div className="ring-label" aria-hidden="true">
        <div>
          <strong className="tabular">{known ? Math.round(v) : '—'}</strong>
          {known && <small>{sublabel ?? '%'}</small>}
        </div>
      </div>
    </div>
  );
}

export function PageHeader({ title, description, actions, children }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
        {children}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}
