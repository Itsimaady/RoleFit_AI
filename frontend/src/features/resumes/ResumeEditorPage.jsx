import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, CheckCircle2, Copy, Download, Eye, FileDown, MessageSquare, Pencil, Save, Target } from 'lucide-react';
import { api, download, fieldErrors } from '../../lib/api.js';
import { validateResume } from '../../lib/validation.js';
import { formatDateTime } from '../../lib/format.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Alert, Button, ConfirmDialog, ErrorState, Meter, PageLoader } from '../../components/ui.jsx';
import { DOCX_LAYOUTS, SECTIONS, TEMPLATES, completeness, toEditorState, toPayload } from './resumeModel.js';
import { SECTION_FORMS } from './SectionForms.jsx';
import { ResumePreview } from './ResumePreview.jsx';

function ExportMenu({ resumeId, title, dirty }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(null);
  const toast = useToast();
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const run = async (kind, layout) => {
    setOpen(false);
    setBusy(kind);
    try {
      const path = kind === 'pdf' ? `/api/resumes/${resumeId}/export/pdf` : `/api/resumes/${resumeId}/export/docx${layout ? `?layout=${layout}` : ''}`;
      await download(path, `${title || 'Resume'}.${kind}`);
      toast.success(`${kind.toUpperCase()} downloaded.`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="menu-wrap" ref={ref}>
      <Button onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open} loading={Boolean(busy)}>
        <Download size={16} /> Export
      </Button>
      {open && (
        <div className="menu" role="menu" style={{ minWidth: 250 }}>
          {dirty && <div className="menu-label" style={{ color: 'var(--warning)', textTransform: 'none', letterSpacing: 0 }}>Exports use the last saved version.</div>}
          <button type="button" role="menuitem" onClick={() => run('pdf')}>
            <FileDown size={16} /> PDF (selected template)
          </button>
          <hr />
          <div className="menu-label">Editable Word (DOCX)</div>
          {DOCX_LAYOUTS.map((l) => (
            <button type="button" role="menuitem" key={l.id} onClick={() => run('docx', l.id)}>
              <FileDown size={16} /> {l.name}
            </button>
          ))}
          <div className="menu-label" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 500 }}>
            DOCX export needs the AI service to be running.
          </div>
        </div>
      )}
    </div>
  );
}

export function ResumeEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [loadState, setLoadState] = useState({ loading: true, error: null });
  const [resume, setResume] = useState(null);
  const [savedJson, setSavedJson] = useState('');
  const [meta, setMeta] = useState({ revision: 1, updatedAt: null });
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved | error
  const [serverErrors, setServerErrors] = useState({});
  const [conflict, setConflict] = useState(false);
  const [active, setActive] = useState('personal');
  const [view, setView] = useState('edit');
  const [duplicating, setDuplicating] = useState(false);
  const savingRef = useRef(false);

  const load = useCallback(
    async (signal) => {
      setLoadState({ loading: true, error: null });
      try {
        const { resume: doc } = await api.get(`/api/resumes/${id}`, { signal });
        const state = toEditorState(doc);
        setResume(state);
        setSavedJson(JSON.stringify(toPayload(state, 0)));
        setMeta({ revision: doc.revision, updatedAt: doc.updatedAt });
        setServerErrors({});
        setSaveState('idle');
        setLoadState({ loading: false, error: null });
      } catch (err) {
        if (err?.name !== 'AbortError') setLoadState({ loading: false, error: err });
      }
    },
    [id],
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const payloadJson = useMemo(() => (resume ? JSON.stringify(toPayload(resume, 0)) : ''), [resume]);
  const dirty = Boolean(resume) && payloadJson !== savedJson;
  const clientErrors = useMemo(() => (resume ? validateResume(resume) : {}), [resume]);
  const errors = { ...serverErrors, ...clientErrors };
  const errorSections = new Set(Object.keys(errors).map((k) => k.split('.')[0]));

  // Server errors refer to the content at save time; clear them once the user edits.
  useEffect(() => {
    if (dirty) setServerErrors({});
    if (dirty && saveState === 'saved') setSaveState('idle');
  }, [payloadJson]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback(async () => {
    if (!resume || savingRef.current) return false;
    if (Object.keys(clientErrors).length) {
      const first = Object.keys(clientErrors)[0].split('.')[0];
      setActive(first === 'title' ? active : first);
      toast.error('Please fix the highlighted fields before saving.');
      return false;
    }
    savingRef.current = true;
    setSaveState('saving');
    const sentJson = payloadJson;
    try {
      const { resume: doc } = await api.put(`/api/resumes/${id}`, toPayload(resume, meta.revision));
      setMeta({ revision: doc.revision, updatedAt: doc.updatedAt });
      // Only mark as saved what was actually sent; edits made during the request stay dirty.
      setSavedJson(sentJson);
      setSaveState('saved');
      return true;
    } catch (err) {
      setSaveState('error');
      if (err.code === 'stale_revision') setConflict(true);
      else {
        setServerErrors(fieldErrors(err));
        toast.error(err.message);
      }
      return false;
    } finally {
      savingRef.current = false;
    }
  }, [resume, clientErrors, payloadJson, id, meta.revision, toast, active]);

  // Ctrl/Cmd + S
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  // Unsaved-change protection: browser refresh/close and in-app navigation.
  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);

  const duplicate = async () => {
    setDuplicating(true);
    try {
      const { resume: copy } = await api.post(`/api/resumes/${id}/duplicate`);
      toast.success(`Created "${copy.title}" from the last saved version.`);
      navigate(`/app/resumes/${copy._id}`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDuplicating(false);
    }
  };

  if (loadState.loading && !resume) return <PageLoader label="Loading resume" />;
  if (loadState.error)
    return (
      <div className="page">
        <div className="card">
          <ErrorState error={loadState.error} onRetry={() => load()} />
        </div>
        <Link to="/app/resumes">
          <ArrowLeft size={14} /> Back to resumes
        </Link>
      </div>
    );

  const Form = SECTION_FORMS[active];
  const sectionMeta = SECTIONS.find((s) => s.id === active);
  const done = completeness(resume);

  const status = {
    saving: { cls: '', icon: <span className="spinner" aria-hidden="true" />, text: 'Saving…' },
    error: { cls: 'error', icon: <AlertTriangle size={14} />, text: 'Not saved' },
    saved: { cls: 'saved', icon: <CheckCircle2 size={14} />, text: 'All changes saved' },
  }[saveState] || (dirty ? { cls: 'dirty', icon: <Pencil size={14} />, text: 'Unsaved changes' } : { cls: '', icon: <CheckCircle2 size={14} />, text: `Saved ${formatDateTime(meta.updatedAt)}` });

  return (
    <div className="page page-wide">
      <div className="stack" style={{ gap: 10 }}>
        <Link to="/app/resumes" className="small">
          <ArrowLeft size={14} style={{ verticalAlign: '-2px' }} /> All resumes
        </Link>
        <div className="editor-toolbar">
          <label htmlFor="resume-title" className="sr-only">
            Resume title
          </label>
          <input
            id="resume-title"
            className="title-input"
            value={resume.title}
            maxLength={100}
            aria-invalid={errors.title ? true : undefined}
            onChange={(e) => setResume((r) => ({ ...r, title: e.target.value }))}
          />
          <span className={`save-state ${status.cls}`} role="status" aria-live="polite">
            {status.icon} {status.text}
          </span>
          <span className="spacer" />
          <Button className="preview-toggle" onClick={() => setView((v) => (v === 'edit' ? 'preview' : 'edit'))} aria-pressed={view === 'preview'}>
            {view === 'edit' ? <Eye size={16} /> : <Pencil size={16} />} {view === 'edit' ? 'Preview' : 'Edit'}
          </Button>
          <Button onClick={duplicate} loading={duplicating} title="Duplicate the saved version">
            <Copy size={16} /> Duplicate
          </Button>
          <ExportMenu resumeId={id} title={resume.title} dirty={dirty} />
          <Button variant="primary" onClick={save} loading={saveState === 'saving'} disabled={!dirty && saveState !== 'error'} title="Save (Ctrl+S)">
            <Save size={16} /> Save
          </Button>
        </div>
        {errors.title && <span className="field-error">{errors.title}</span>}
      </div>

      <div className="editor" data-view={view}>
        <nav className="card section-nav" aria-label="Resume sections">
          {SECTIONS.map((s) => (
            <button key={s.id} type="button" aria-current={active === s.id ? 'true' : undefined} onClick={() => setActive(s.id)}>
              {s.label}
              <span className={`status-dot ${errorSections.has(s.id) ? 'error' : s.filled(resume) ? 'filled' : ''}`} aria-label={errorSections.has(s.id) ? 'has errors' : s.filled(resume) ? 'has content' : s.optional ? 'optional, empty' : 'empty'} />
            </button>
          ))}
          <div className="completeness">
            {done.filled} of {done.total} core sections have content
            <Meter value={done.percent} tone={done.percent === 100 ? 'success' : ''} label="Core sections with content" />
          </div>
        </nav>

        <section className="card editor-form" aria-labelledby="section-title">
          <div className="card-header">
            <h2 id="section-title">{sectionMeta.label}</h2>
            {sectionMeta.optional && <span className="small muted">Optional</span>}
          </div>
          <div className="card-body">
            <Form resume={resume} setResume={setResume} errors={errors} />
          </div>
          <div className="card-footer" style={{ justifyContent: 'space-between' }}>
            <div className="row">
              {active === 'personal' && (
                <div className="field" style={{ minWidth: 0 }}>
                  <span className="field-label">Template</span>
                  <div className="template-options" role="radiogroup" aria-label="Template">
                    {TEMPLATES.map((t) => (
                      <button key={t.id} type="button" role="radio" aria-checked={resume.template === t.id} className="template-option" onClick={() => setResume((r) => ({ ...r, template: t.id }))}>
                        <b>{t.name}</b>
                        <small>{t.description}</small>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="row">
              <Link className="btn btn-ghost btn-sm" to={`/app/analyses?resume=${id}`}>
                <Target size={14} /> Match to a job
              </Link>
              <Link className="btn btn-ghost btn-sm" to={`/app/interviews?resume=${id}`}>
                <MessageSquare size={14} /> Practise interview
              </Link>
            </div>
          </div>
        </section>

        <aside className="preview-pane" aria-label="Live preview">
          <div className="row" style={{ marginBottom: 8, justifyContent: 'space-between' }}>
            <span className="small muted">Live preview · {TEMPLATES.find((t) => t.id === resume.template)?.name}</span>
            <span className="small muted">PDF export uses the same layout</span>
          </div>
          <div className="preview-scroller">
            <ResumePreview resume={resume} />
          </div>
        </aside>
      </div>

      {Object.keys(serverErrors).length > 0 && (
        <Alert tone="danger" title="Some fields were rejected by the server">
          {Object.values(serverErrors).slice(0, 3).join(' · ')}
        </Alert>
      )}

      <ConfirmDialog
        open={blocker.state === 'blocked'}
        title="Leave without saving?"
        confirmLabel="Discard changes and leave"
        cancelLabel="Stay on this page"
        tone="danger"
        onCancel={() => blocker.reset?.()}
        onConfirm={() => blocker.proceed?.()}
      >
        <p>You have unsaved changes to this resume. Stay on the page and press Save to keep them.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={conflict}
        title="This resume changed somewhere else"
        confirmLabel="Load latest version"
        cancelLabel="Keep editing"
        tone="danger"
        onConfirm={() => {
          setConflict(false);
          load();
        }}
        onCancel={() => setConflict(false)}
      >
        <p>It was saved from another tab or device after you opened it. Loading the latest version discards your unsaved edits here. To keep both, copy your changes first.</p>
      </ConfirmDialog>
    </div>
  );
}
