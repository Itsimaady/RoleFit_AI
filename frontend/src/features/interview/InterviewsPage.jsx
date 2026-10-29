import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Camera, FileText, Mic, MessageSquare, ShieldCheck, Trash2 } from 'lucide-react';
import { api, fieldErrors } from '../../lib/api.js';
import { STATUS_LABEL, STATUS_TONE, formatDate } from '../../lib/format.js';
import { useApiData } from '../../hooks/useApiData.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Alert, Badge, Button, ConfirmDialog, EmptyState, ErrorState, PageHeader, SkeletonList } from '../../components/ui.jsx';
import { JobForm, validateJobForm } from '../analysis/AnalysisPage.jsx';

export function InterviewsPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const availability = useApiData('/api/interviews/availability');
  const resumes = useApiData('/api/resumes?limit=50');
  const history = useApiData('/api/interviews?limit=20');
  const analysisId = params.get('analysis');
  const linkedAnalysis = useApiData(analysisId ? `/api/analyses/${analysisId}` : null);
  const [values, setValues] = useState({ resumeId: params.get('resume') || '', targetRole: '', jobDescription: '' });
  const [errors, setErrors] = useState({});
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // Prefill from a job analysis ("Practise an interview for this job").
  useEffect(() => {
    const a = linkedAnalysis.data?.analysis;
    if (a) setValues((v) => ({ ...v, resumeId: a.resume || v.resumeId, targetRole: a.targetRole || v.targetRole, jobDescription: a.jobDescription }));
  }, [linkedAnalysis.data]);

  const ready = availability.data?.ready;

  const create = async (e) => {
    e.preventDefault();
    const clientErrors = validateJobForm(values, { roleRequired: true });
    setErrors(clientErrors);
    if (Object.keys(clientErrors).length) return;
    setCreating(true);
    try {
      const { session } = await api.post('/api/interviews', { resumeId: values.resumeId, targetRole: values.targetRole.trim(), jobDescription: values.jobDescription.trim() });
      navigate(`/app/interviews/${session._id}/live`);
    } catch (err) {
      setErrors(fieldErrors(err));
      toast.error(err.message);
      if (err.status === 503) availability.reload();
      setCreating(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await api.del(`/api/interviews/${toDelete._id}`);
      history.setData((d) => ({ ...d, items: d.items.filter((i) => i._id !== toDelete._id), total: d.total - 1 }));
      toast.success('Interview deleted.');
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
      <PageHeader title="Mock interviews" description="A live voice interview with 12 questions generated from your resume and the job description." />

      {availability.data && !ready && (
        <Alert
          tone="warning"
          title="Live interviews are not available right now"
          action={
            <Button size="sm" onClick={availability.reload}>
              Check again
            </Button>
          }
        >
          {availability.data.message} Your resumes, job analyses and past interview reports still work.
        </Alert>
      )}
      {availability.error && <Alert tone="warning" title="Could not check interview availability">{availability.error.message}</Alert>}

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <form className="card" onSubmit={create} noValidate aria-labelledby="setup-title" style={{ gridColumn: 'span 1' }}>
          <div className="card-header">
            <h2 id="setup-title">
              <MessageSquare size={17} /> Set up an interview
            </h2>
          </div>
          <div className="card-body">
            {resumes.loading && !resumes.data ? (
              <SkeletonList rows={2} />
            ) : resumes.error ? (
              <ErrorState error={resumes.error} onRetry={resumes.reload} />
            ) : resumeItems.length === 0 ? (
              <EmptyState icon={FileText} title="You need a resume first" action={<Link className="btn btn-primary" to="/app/resumes?new=1">Create a resume</Link>}>
                Questions are personalised from your saved resume.
              </EmptyState>
            ) : (
              <JobForm resumes={resumeItems} values={values} setValues={setValues} errors={errors} disabled={creating} roleRequired />
            )}
          </div>
          {resumeItems.length > 0 && (
            <div className="card-footer">
              {!ready && <span className="small muted" style={{ marginRight: 'auto' }}>Unavailable until the AI service and Gemini are configured.</span>}
              <Button type="submit" variant="primary" loading={creating} disabled={!ready}>
                {creating ? 'Preparing questions…' : 'Prepare interview'}
              </Button>
            </div>
          )}
        </form>

        <section className="card permission-card" aria-labelledby="privacy-title">
          <div className="card-header">
            <h2 id="privacy-title">
              <ShieldCheck size={17} /> What the interview uses
            </h2>
          </div>
          <div className="card-body stack">
            <div>
              <b className="row" style={{ gap: 8 }}>
                <Mic size={16} /> Microphone (required)
              </b>
              <ul>
                <li>Your voice is streamed to Google Gemini Live through our server so the AI interviewer can hear and reply.</li>
                <li>We save the text transcript of each answer with its feedback. Audio is not recorded.</li>
              </ul>
            </div>
            <div>
              <b className="row" style={{ gap: 8 }}>
                <Camera size={16} /> Camera (optional)
              </b>
              <ul>
                <li>Video never leaves your browser. It is only used to estimate eye contact, posture and movement.</li>
                <li>These signals are rough approximations. They do not measure personality, honesty or suitability for a job.</li>
              </ul>
            </div>
            <p className="small muted">You can mute, turn the camera off, or end the interview at any time.</p>
          </div>
        </section>
      </div>

      <section className="card" aria-labelledby="interview-history">
        <div className="card-header">
          <h2 id="interview-history">Your sessions</h2>
          {history.data && <span className="small muted">{history.data.total} total</span>}
        </div>
        {history.error ? (
          <ErrorState error={history.error} onRetry={history.reload} />
        ) : history.loading && !history.data ? (
          <SkeletonList />
        ) : history.data?.items.length ? (
          <ul className="list">
            {history.data.items.map((s) => {
              const resumable = s.status === 'ready' || s.status === 'in_progress';
              return (
                <li className="list-row" key={s._id}>
                  <div className="grow">
                    <Link className="title" to={resumable ? `/app/interviews/${s._id}/live` : `/app/interviews/${s._id}`}>
                      {s.targetRole}
                    </Link>
                    <span className="meta">
                      {s.resumeTitle} · {formatDate(s.createdAt)} · {s.answeredCount}/12 answered
                      {s.questionSource === 'fallback' && ' · template questions'}
                    </span>
                  </div>
                  {s.status === 'completed' && s.report?.overall_score != null ? <Badge tone="tone-success">{s.report.overall_score}/100</Badge> : <Badge tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</Badge>}
                  {resumable && (
                    <Link className="btn btn-sm" to={`/app/interviews/${s._id}/live`}>
                      {s.status === 'ready' ? 'Start' : 'Continue'}
                    </Link>
                  )}
                  <Button size="sm" variant="ghost" className="btn-icon" onClick={() => setToDelete(s)} aria-label={`Delete interview for ${s.targetRole}`}>
                    <Trash2 size={15} />
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState icon={MessageSquare} title="No interview sessions yet">
            Completed interviews and their feedback reports will be listed here.
          </EmptyState>
        )}
      </section>

      <ConfirmDialog open={Boolean(toDelete)} title="Delete this interview?" confirmLabel="Delete" tone="danger" loading={deleting} onConfirm={remove} onCancel={() => setToDelete(null)}>
        <p>The transcript and feedback for “{toDelete?.targetRole}” will be permanently deleted.</p>
      </ConfirmDialog>
    </div>
  );
}
