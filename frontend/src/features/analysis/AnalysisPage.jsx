import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FileText, Target, Trash2 } from 'lucide-react';
import { api, fieldErrors } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';
import { useApiData } from '../../hooks/useApiData.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Button, ConfirmDialog, EmptyState, ErrorState, Field, PageHeader, SkeletonList, TextField } from '../../components/ui.jsx';

export const JD_MIN = 80;
export const JD_MAX = 20000;

/** Resume picker + target role + job description, shared by analysis and interview setup. */
export function JobForm({ resumes, values, setValues, errors, disabled, roleRequired = false }) {
  const length = values.jobDescription.length;
  return (
    <div className="form-grid">
      <Field label="Resume" error={errors.resumeId} required>
        {(a11y) => (
          <select className="select" {...a11y} value={values.resumeId} disabled={disabled} onChange={(e) => setValues((v) => ({ ...v, resumeId: e.target.value }))}>
            <option value="">Select a saved resume…</option>
            {resumes.map((r) => (
              <option key={r._id} value={r._id}>
                {r.title}
              </option>
            ))}
          </select>
        )}
      </Field>
      <TextField
        label={roleRequired ? 'Target role' : 'Target role (optional)'}
        required={roleRequired}
        placeholder="Backend Developer Intern"
        maxLength={120}
        value={values.targetRole}
        disabled={disabled}
        error={errors.targetRole}
        onChange={(e) => setValues((v) => ({ ...v, targetRole: e.target.value }))}
      />
      <div className="span-2 stack" style={{ gap: 4 }}>
        <TextField
          label="Job description"
          required
          multiline
          rows={10}
          disabled={disabled}
          value={values.jobDescription}
          error={errors.jobDescription}
          placeholder="Paste the full job description, including responsibilities and requirements…"
          onChange={(e) => setValues((v) => ({ ...v, jobDescription: e.target.value }))}
        />
        <span className={`char-count${length > JD_MAX ? ' over' : ''}`}>
          {length.toLocaleString()} / {JD_MAX.toLocaleString()} characters{length > 0 && length < JD_MIN ? ` · at least ${JD_MIN} needed` : ''}
        </span>
      </div>
    </div>
  );
}

export function validateJobForm(values, { roleRequired = false } = {}) {
  const errors = {};
  if (!values.resumeId) errors.resumeId = 'Choose a resume';
  if (roleRequired && values.targetRole.trim().length < 2) errors.targetRole = 'Enter the role you are preparing for';
  const jd = values.jobDescription.trim();
  if (!jd) errors.jobDescription = 'Paste a job description';
  else if (jd.length < JD_MIN) errors.jobDescription = `Add more of the job description (at least ${JD_MIN} characters)`;
  else if (jd.length > JD_MAX) errors.jobDescription = `Job description must be at most ${JD_MAX.toLocaleString()} characters`;
  return errors;
}

export function AnalysisPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const resumes = useApiData('/api/resumes?limit=50');
  const history = useApiData('/api/analyses?limit=20');
  const [values, setValues] = useState({ resumeId: params.get('resume') || '', targetRole: '', jobDescription: '' });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // Pre-select the only resume when there is exactly one.
  useEffect(() => {
    const items = resumes.data?.items;
    if (items?.length === 1 && !values.resumeId) setValues((v) => ({ ...v, resumeId: items[0]._id }));
  }, [resumes.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e) => {
    e.preventDefault();
    const clientErrors = validateJobForm(values);
    setErrors(clientErrors);
    if (Object.keys(clientErrors).length) return;
    setSubmitting(true);
    try {
      const { analysis } = await api.post('/api/analyses', { ...values, targetRole: values.targetRole.trim(), jobDescription: values.jobDescription.trim() });
      navigate(`/app/analyses/${analysis._id}`);
    } catch (err) {
      setErrors(fieldErrors(err));
      toast.error(err.message);
      setSubmitting(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await api.del(`/api/analyses/${toDelete._id}`);
      history.setData((d) => ({ ...d, items: d.items.filter((a) => a._id !== toDelete._id), total: d.total - 1 }));
      toast.success('Analysis deleted.');
      setToDelete(null);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDeleting(false);
    }
  };

  const resumeItems = resumes.data?.items || [];

  return (
    <div className="page">
      <PageHeader title="Job match" description="Compare a saved resume with a real job description to see what you already demonstrate and what is missing." />

      <form className="card" onSubmit={submit} noValidate aria-labelledby="new-analysis">
        <div className="card-header">
          <h2 id="new-analysis">
            <Target size={17} /> New analysis
          </h2>
        </div>
        <div className="card-body">
          {resumes.error ? (
            <ErrorState error={resumes.error} onRetry={resumes.reload} />
          ) : resumes.loading && !resumes.data ? (
            <SkeletonList rows={2} />
          ) : resumeItems.length === 0 ? (
            <EmptyState icon={FileText} title="You need a resume first" action={<Link className="btn btn-primary" to="/app/resumes?new=1">Create a resume</Link>}>
              Analyses compare one of your saved resumes with a job description.
            </EmptyState>
          ) : (
            <JobForm resumes={resumeItems} values={values} setValues={setValues} errors={errors} disabled={submitting} />
          )}
        </div>
        {resumeItems.length > 0 && (
          <div className="card-footer">
            <span className="small muted" style={{ marginRight: 'auto' }}>
              Runs instantly on our server. No AI service required.
            </span>
            <Button type="submit" variant="primary" loading={submitting}>
              {submitting ? 'Analyzing…' : 'Analyze match'}
            </Button>
          </div>
        )}
      </form>

      <section className="card" aria-labelledby="analysis-history">
        <div className="card-header">
          <h2 id="analysis-history">History</h2>
          {history.data && <span className="small muted">{history.data.total} saved</span>}
        </div>
        {history.error ? (
          <ErrorState error={history.error} onRetry={history.reload} />
        ) : history.loading && !history.data ? (
          <SkeletonList />
        ) : history.data?.items.length ? (
          <ul className="list">
            {history.data.items.map((a) => (
              <li className="list-row" key={a._id}>
                <div className="grow">
                  <Link className="title" to={`/app/analyses/${a._id}`}>
                    {a.targetRole || 'Untitled role'}
                  </Link>
                  <span className="meta">
                    {a.resumeSnapshot?.title} · {formatDate(a.createdAt)} · {a.missingSkills?.length || 0} skills not found
                  </span>
                </div>
                <span className="small" style={{ whiteSpace: 'nowrap' }}>
                  {a.scores?.skillCoverage != null ? `${a.scores.skillCoverage}% skills` : 'No skills detected'}
                </span>
                <Button size="sm" variant="ghost" className="btn-icon" onClick={() => setToDelete(a)} aria-label={`Delete analysis for ${a.targetRole || 'untitled role'}`}>
                  <Trash2 size={15} />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={Target} title="No analyses yet">
            Your completed analyses are saved here so you can compare roles over time.
          </EmptyState>
        )}
      </section>

      <ConfirmDialog open={Boolean(toDelete)} title="Delete this analysis?" confirmLabel="Delete" tone="danger" loading={deleting} onConfirm={remove} onCancel={() => setToDelete(null)}>
        <p>The saved results for “{toDelete?.targetRole || 'Untitled role'}” will be permanently removed.</p>
      </ConfirmDialog>
    </div>
  );
}
