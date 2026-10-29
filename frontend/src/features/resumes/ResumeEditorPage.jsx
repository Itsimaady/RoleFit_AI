import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Award,
  Briefcase,
  CheckCircle2,
  Copy,
  Download,
  FileDown,
  FolderGit2,
  GraduationCap,
  Link2,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Save,
  ScrollText,
  Target,
  Trash2,
  Trophy,
  UserRound,
  Wrench,
} from 'lucide-react';
import { api, download, fieldErrors } from '../../lib/api.js';
import { validateResume } from '../../lib/validation.js';
import { formatDateTime } from '../../lib/format.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Alert, Button, ConfirmDialog, ErrorState, Meter, PageLoader } from '../../components/ui.jsx';
import { DOCX_LAYOUTS, SECTIONS, TEMPLATES, completeness, toEditorState, toPayload } from './resumeModel.js';
import { SECTION_FORMS } from './SectionForms.jsx';
import { ResumePreview } from './ResumePreview.jsx';

const SECTION_ICONS = {
  personal: UserRound,
  summary: ScrollText,
  education: GraduationCap,
  experience: Briefcase,
  projects: FolderGit2,
  skills: Wrench,
  certifications: Award,
  achievements: Trophy,
  links: Link2,
};

/** Small dropdown with outside-click / Escape handling. */
function Dropdown({ label, icon: Icon, children, buttonProps = {}, width = 240 }) {
  const [open, setOpen] = useState(false);
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
  return (
    <div className="menu-wrap" ref={ref}>
      <Button onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open} {...buttonProps}>
        {Icon && <Icon size={15} />}
        {label}
      </Button>
      {open && (
        <div className="menu" role="menu" style={{ minWidth: width }} onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

function ExportMenu({ resumeId, title, dirty }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const run = async (kind, layout) => {
    setBusy(true);
    try {
      const path = kind === 'pdf' ? `/api/resumes/${resumeId}/export/pdf` : `/api/resumes/${resumeId}/export/docx${layout ? `?layout=${layout}` : ''}`;
      await download(path, `${title || 'Resume'}.${kind}`);
      toast.success(`${kind.toUpperCase()} downloaded.`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dropdown label={<span className="btn-label">Export</span>} icon={Download} width={260} buttonProps={{ loading: busy, 'aria-label': 'Export', title: 'Export PDF or DOCX' }}>
      {dirty && <div className="menu-note" style={{ color: 'var(--warning)' }}>Exports use the last saved version — save first to include recent edits.</div>}
      <div className="menu-label">PDF</div>
      <button type="button" role="menuitem" onClick={() => run('pdf')}>
        <FileDown size={15} /> PDF · current template
      </button>
      <hr />
      <div className="menu-label">Editable Word (DOCX)</div>
      {DOCX_LAYOUTS.map((l) => (
        <button type="button" role="menuitem" key={l.id} onClick={() => run('docx', l.id)}>
          <FileDown size={15} /> {l.name}
        </button>
      ))}
      <div className="menu-note">DOCX export needs the AI service to be running.</div>
    </Dropdown>
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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const savingRef = useRef(false);
  const leavingRef = useRef(false);
  const formTopRef = useRef(null);

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
      if (first !== 'title') setActive(first);
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
  }, [resume, clientErrors, payloadJson, id, meta.revision, toast]);

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
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !leavingRef.current && currentLocation.pathname !== nextLocation.pathname);

  const duplicate = async () => {
    try {
      const { resume: copy } = await api.post(`/api/resumes/${id}/duplicate`);
      toast.success(`Created "${copy.title}" from the last saved version.`);
      navigate(`/app/resumes/${copy._id}`);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await api.del(`/api/resumes/${id}`);
      leavingRef.current = true;
      toast.success(`Deleted "${resume.title}".`);
      navigate('/app/resumes', { replace: true });
    } catch (err) {
      toast.error(err.message);
      setDeleting(false);
    }
  };

  const goTo = (sectionId) => {
    setActive(sectionId);
    formTopRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  };

  if (loadState.loading && !resume) return <PageLoader label="Loading resume" />;
  if (loadState.error)
    return (
      <div className="page">
        <Link to="/app/resumes" className="back-link">
          <ArrowLeft size={14} /> All resumes
        </Link>
        <div className="card">
          <ErrorState error={loadState.error} onRetry={() => load()} />
        </div>
      </div>
    );

  const Form = SECTION_FORMS[active];
  const index = SECTIONS.findIndex((s) => s.id === active);
  const sectionMeta = SECTIONS[index];
  const prev = SECTIONS[index - 1];
  const next = SECTIONS[index + 1];
  const done = completeness(resume);
  const SectionIcon = SECTION_ICONS[active];

  const status = {
    saving: { cls: 'saving', icon: <span className="spinner" aria-hidden="true" />, text: 'Saving…' },
    error: { cls: 'error', icon: <AlertTriangle size={13} />, text: 'Not saved' },
    saved: { cls: 'saved', icon: <CheckCircle2 size={13} />, text: 'All changes saved' },
  }[saveState] || (dirty ? { cls: 'dirty', icon: <Pencil size={13} />, text: 'Unsaved changes' } : { cls: '', icon: <CheckCircle2 size={13} />, text: `Saved ${formatDateTime(meta.updatedAt)}` });

  return (
    <div className="page page-wide editor-page">
      <div className="editor-toolbar card">
        <Link to="/app/resumes" className="btn btn-ghost btn-icon btn-sm toolbar-back" aria-label="Back to all resumes" title="All resumes">
          <ArrowLeft size={16} />
        </Link>
        <div className="title-wrap">
          <label htmlFor="resume-title" className="sr-only">
            Resume title
          </label>
          <input id="resume-title" className="title-input" value={resume.title} maxLength={100} aria-invalid={errors.title ? true : undefined} onChange={(e) => setResume((r) => ({ ...r, title: e.target.value }))} />
          <span className={`save-state ${status.cls}`} role="status" aria-live="polite">
            {status.icon} {status.text}
          </span>
        </div>
        <span className="spacer" />
        <div className="segmented view-toggle" role="radiogroup" aria-label="View">
          <button type="button" role="radio" aria-checked={view === 'edit'} onClick={() => setView('edit')}>
            Edit
          </button>
          <button type="button" role="radio" aria-checked={view === 'preview'} onClick={() => setView('preview')}>
            Preview
          </button>
        </div>
        <ExportMenu resumeId={id} title={resume.title} dirty={dirty} />
        <Dropdown icon={MoreHorizontal} buttonProps={{ className: 'btn-icon', 'aria-label': 'More actions', title: 'More actions' }}>
          <button type="button" role="menuitem" onClick={duplicate}>
            <Copy size={15} /> Duplicate saved version
          </button>
          <Link role="menuitem" to={`/app/analyses?resume=${id}`}>
            <Target size={15} /> Match to a job
          </Link>
          <Link role="menuitem" to={`/app/interviews?resume=${id}`}>
            <MessageSquare size={15} /> Practise an interview
          </Link>
          <hr />
          <button type="button" role="menuitem" className="danger" onClick={() => setConfirmDelete(true)}>
            <Trash2 size={15} /> Delete resume
          </button>
        </Dropdown>
        <Button variant="primary" onClick={save} loading={saveState === 'saving'} disabled={!dirty && saveState !== 'error'} title="Save (Ctrl+S)">
          <Save size={15} /> Save
          <span className="kbd save-kbd" aria-hidden="true">
            Ctrl S
          </span>
        </Button>
      </div>
      {errors.title && <span className="field-error">{errors.title}</span>}

      <div className="editor" data-view={view}>
        <nav className="section-nav" aria-label="Resume sections">
          <span className="section-title nav-heading">Sections</span>
          {SECTIONS.map((s) => {
            const Icon = SECTION_ICONS[s.id];
            const state = errorSections.has(s.id) ? 'error' : s.filled(resume) ? 'filled' : '';
            return (
              <button key={s.id} type="button" aria-current={active === s.id ? 'true' : undefined} onClick={() => goTo(s.id)}>
                <Icon size={15} aria-hidden="true" />
                <span className="label">{s.label}</span>
                <span className={`status-dot ${state}`} aria-label={state === 'error' ? 'has errors' : state === 'filled' ? 'has content' : s.optional ? 'optional, empty' : 'empty'} />
              </button>
            );
          })}
          <div className="completeness">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span>Core sections</span>
              <b className="tabular">
                {done.filled}/{done.total}
              </b>
            </div>
            <Meter value={done.percent} tone={done.percent === 100 ? 'success' : ''} label="Core sections with content" />
          </div>
        </nav>

        <section className="card editor-form" aria-labelledby="section-title" ref={formTopRef}>
          <div className="editor-form-head">
            <span className="section-icon" aria-hidden="true">
              <SectionIcon size={17} />
            </span>
            <div style={{ minWidth: 0 }}>
              <div className="xsmall muted">
                Section {index + 1} of {SECTIONS.length}
                {sectionMeta.optional && ' · optional'}
              </div>
              <h2 id="section-title">{sectionMeta.label}</h2>
              <p className="small muted">{sectionMeta.description}</p>
            </div>
          </div>
          <div className="card-body">
            <Form resume={resume} setResume={setResume} errors={errors} />
          </div>
          <div className="card-footer" style={{ justifyContent: 'space-between' }}>
            {prev ? (
              <Button variant="ghost" onClick={() => goTo(prev.id)}>
                <ArrowLeft size={15} /> {prev.label}
              </Button>
            ) : (
              <span />
            )}
            {next && (
              <Button onClick={() => goTo(next.id)}>
                {next.label} <ArrowRight size={15} />
              </Button>
            )}
          </div>
        </section>

        <aside className="preview-pane" aria-label="Live preview">
          <div className="preview-head">
            <div className="segmented" role="radiogroup" aria-label="Template">
              {TEMPLATES.map((t) => (
                <button key={t.id} type="button" role="radio" aria-checked={resume.template === t.id} title={t.description} onClick={() => setResume((r) => ({ ...r, template: t.id }))}>
                  {t.name}
                </button>
              ))}
            </div>
            <span className="xsmall muted">Live · PDF uses this layout</span>
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

      <ConfirmDialog open={confirmDelete} title="Delete this resume?" confirmLabel="Delete resume" tone="danger" loading={deleting} onConfirm={remove} onCancel={() => setConfirmDelete(false)}>
        <p>“{resume.title}” will be permanently deleted. Past job analyses keep a snapshot of its title. This cannot be undone.</p>
      </ConfirmDialog>
    </div>
  );
}
