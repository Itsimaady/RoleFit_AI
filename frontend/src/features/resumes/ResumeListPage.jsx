import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Copy, FileText, FileUp, Pencil, Plus, Search, Target, Trash2 } from 'lucide-react';
import { api } from '../../lib/api.js';
import { timeAgo } from '../../lib/format.js';
import { useApiData } from '../../hooks/useApiData.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, PageHeader, SkeletonList, TextField } from '../../components/ui.jsx';

const ACCEPT = '.pdf,.docx,.txt,.md';
const MAX_UPLOAD = 10 * 1024 * 1024;

function CreateDialog({ open, onClose }) {
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    if (open) {
      setTitle('');
      setError('');
    }
  }, [open]);

  const create = async () => {
    if (!title.trim()) return setError('Give your resume a title, e.g. "Backend Developer – 2025"');
    setSaving(true);
    try {
      const { resume } = await api.post('/api/resumes', { title: title.trim() });
      toast.success('Resume created.');
      navigate(`/app/resumes/${resume._id}`);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <ConfirmDialog open={open} title="Create a resume" confirmLabel="Create and edit" onConfirm={create} onCancel={onClose} loading={saving}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <TextField label="Resume title" value={title} onChange={(e) => setTitle(e.target.value)} error={error} hint="Only you see the title. Use it to tell versions apart." maxLength={100} autoFocus />
      </form>
    </ConfirmDialog>
  );
}

export function ResumeListPage() {
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [creating, setCreating] = useState(params.get('new') === '1');
  const [toDelete, setToDelete] = useState(null);
  const [busy, setBusy] = useState(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef(null);
  const toast = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const path = `/api/resumes?limit=50${debounced ? `&q=${encodeURIComponent(debounced)}` : ''}`;
  const { data, error, loading, reload, setData } = useApiData(path);

  const closeCreate = () => {
    setCreating(false);
    if (params.get('new')) setParams({}, { replace: true });
  };

  const duplicate = async (resume) => {
    setBusy(resume._id);
    try {
      const { resume: copy } = await api.post(`/api/resumes/${resume._id}/duplicate`);
      toast.success(`Created "${copy.title}".`);
      reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    const target = toDelete;
    setBusy(target._id);
    try {
      await api.del(`/api/resumes/${target._id}`);
      setData((d) => ({ ...d, items: d.items.filter((r) => r._id !== target._id), total: d.total - 1 }));
      toast.success(`Deleted "${target.title}".`);
      setToDelete(null);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  const onImport = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_UPLOAD) return toast.error('That file is larger than 10 MB.');
    const form = new FormData();
    form.append('file', file);
    setImporting(true);
    try {
      const { resume, notice } = await api.upload('/api/resumes/import', form);
      toast.info(notice);
      navigate(`/app/resumes/${resume._id}`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setImporting(false);
    }
  };

  const items = data?.items || [];

  return (
    <div className="page">
      <PageHeader
        title="Resumes"
        description="Keep a tailored version for each kind of role you apply to. Every resume is private to your account."
        actions={
          <>
            <input ref={fileRef} type="file" accept={ACCEPT} hidden onChange={onImport} aria-label="Import a resume file" />
            <Button onClick={() => fileRef.current?.click()} loading={importing} title="Import PDF, DOCX or TXT (uses the AI service parser)">
              <FileUp size={16} /> Import file
            </Button>
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus size={16} /> New resume
            </Button>
          </>
        }
      />

      <div className="list-toolbar">
        <div className="search">
          <label htmlFor="resume-search" className="sr-only">
            Search resumes
          </label>
          <Search size={15} aria-hidden="true" />
          <input id="resume-search" className="input" type="search" placeholder="Search by title" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {data && (
          <span className="small muted">
            {data.total} resume{data.total === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {error ? (
        <div className="card">
          <ErrorState error={error} onRetry={reload} />
        </div>
      ) : loading && !data ? (
        <div className="card">
          <SkeletonList rows={4} />
        </div>
      ) : items.length === 0 ? (
        <div className="card">
          {debounced ? (
            <EmptyState icon={Search} title="No matching resumes">
              Nothing matches “{debounced}”. Try a different title.
            </EmptyState>
          ) : (
            <EmptyState
              icon={FileText}
              title="Create your first resume"
              action={
                <Button variant="primary" onClick={() => setCreating(true)}>
                  <Plus size={16} /> New resume
                </Button>
              }
            >
              Start from a guided blank template, or import an existing PDF, DOCX or TXT file.
            </EmptyState>
          )}
        </div>
      ) : (
        <div className="resume-grid">
          {!debounced && (
            <button type="button" className="new-card" onClick={() => setCreating(true)}>
              <span className="row-icon">
                <Plus size={18} />
              </span>
              New resume
              <span className="xsmall muted" style={{ fontWeight: 400 }}>
                Blank guided template
              </span>
            </button>
          )}
          {items.map((r) => (
            <article className="card card-link resume-card" key={r._id}>
              <Link to={`/app/resumes/${r._id}`} className="resume-card-thumb" aria-label={`Edit ${r.title}`}>
                <div className={`mini-paper ${r.template}`} aria-hidden="true">
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                </div>
              </Link>
              <div className="resume-card-body">
                <Link className="title" to={`/app/resumes/${r._id}`}>
                  {r.title}
                </Link>
                <span className="small muted">{r.personal?.headline || r.personal?.fullName || 'No name added yet'}</span>
                <div className="row" style={{ marginTop: 4 }}>
                  <Badge>{r.template}</Badge>
                  <span className="small muted">Updated {timeAgo(r.updatedAt)}</span>
                </div>
              </div>
              <div className="resume-card-foot">
                <Link className="btn btn-sm" to={`/app/resumes/${r._id}`}>
                  <Pencil size={14} /> Edit
                </Link>
                <Link className="btn btn-sm btn-ghost" to={`/app/analyses?resume=${r._id}`} title="Match against a job">
                  <Target size={14} /> Match
                </Link>
                <span className="spacer" />
                <Button size="sm" variant="ghost" className="btn-icon" onClick={() => duplicate(r)} loading={busy === r._id && !toDelete} aria-label={`Duplicate ${r.title}`} title="Duplicate">
                  <Copy size={15} />
                </Button>
                <Button size="sm" variant="ghost" className="btn-icon" onClick={() => setToDelete(r)} aria-label={`Delete ${r.title}`} title="Delete">
                  <Trash2 size={15} />
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}

      <CreateDialog open={creating} onClose={closeCreate} />
      <ConfirmDialog
        open={Boolean(toDelete)}
        title="Delete this resume?"
        confirmLabel="Delete resume"
        tone="danger"
        loading={Boolean(toDelete && busy === toDelete._id)}
        onConfirm={remove}
        onCancel={() => setToDelete(null)}
      >
        <p>
          “{toDelete?.title}” will be permanently deleted. Past job analyses keep a snapshot of its title. This cannot be undone.
        </p>
      </ConfirmDialog>
    </div>
  );
}
