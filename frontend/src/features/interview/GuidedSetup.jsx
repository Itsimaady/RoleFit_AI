import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, CheckCircle2, Mic, Play, Settings2, ShieldCheck, Sparkles, Volume2 } from 'lucide-react';
import { api, fieldErrors } from '../../lib/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Alert, Button, Field, Meter, TextField } from '../../components/ui.jsx';
import { CATEGORIES, DIFFICULTIES, QUESTION_COUNTS, RECOGNITION_LANGUAGES, loadVoiceSettings, saveVoiceSettings } from './guidedModel.js';
import { createSpeaker } from './speech/speaker.js';
import { getRecognitionClass } from './speech/recognitionController.js';

function MicTest() {
  const [state, setState] = useState('idle'); // idle | testing | heard | silent | denied | unsupported
  const [level, setLevel] = useState(0);
  const cleanup = useRef(() => {});
  useEffect(() => () => cleanup.current(), []);

  const run = async () => {
    if (!navigator.mediaDevices?.getUserMedia) return setState('unsupported');
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch {
      return setState('denied');
    }
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    let peak = 0;
    let raf = 0;
    const tick = () => {
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += v * v;
      const lvl = Math.min(1, Math.sqrt(sum / data.length) * 6);
      peak = Math.max(peak, lvl);
      setLevel(lvl);
      raf = requestAnimationFrame(tick);
    };
    cleanup.current = () => {
      cancelAnimationFrame(raf);
      stream.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => {});
      setLevel(0);
    };
    setState('testing');
    tick();
    setTimeout(() => {
      cleanup.current();
      cleanup.current = () => {};
      setState(peak > 0.08 ? 'heard' : 'silent');
    }, 4000);
  };

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row">
        <Button size="sm" onClick={run} disabled={state === 'testing'}>
          <Mic size={14} /> {state === 'testing' ? 'Listening… say something' : 'Test microphone'}
        </Button>
        {state === 'heard' && (
          <span className="xsmall" style={{ color: 'var(--success)', fontWeight: 600 }}>
            <CheckCircle2 size={13} style={{ verticalAlign: '-2px' }} /> Microphone is picking up sound
          </span>
        )}
        {state === 'silent' && <span className="xsmall" style={{ color: 'var(--warning)' }}>No sound detected — check the selected microphone.</span>}
        {state === 'denied' && <span className="xsmall" style={{ color: 'var(--danger)' }}>Microphone permission was blocked.</span>}
        {state === 'unsupported' && <span className="xsmall muted">This browser cannot access a microphone.</span>}
      </div>
      {state === 'testing' && <Meter value={level * 100} tone="success" label="Microphone level" />}
    </div>
  );
}

function VoiceSettings({ value, onChange }) {
  const speaker = useMemo(() => createSpeaker(), []);
  const [voices, setVoices] = useState(() => speaker.voices());
  useEffect(() => {
    if (!speaker.supported) return undefined;
    const update = () => setVoices(speaker.voices());
    window.speechSynthesis.addEventListener?.('voiceschanged', update);
    update();
    return () => {
      window.speechSynthesis.removeEventListener?.('voiceschanged', update);
      speaker.cancel();
    };
  }, [speaker]);
  const english = voices.filter((v) => /^en/i.test(v.lang));
  const set = (patch) => onChange({ ...value, ...patch });
  const recognitionSupported = Boolean(getRecognitionClass());

  return (
    <div className="stack" style={{ gap: 16 }}>
      {!speaker.supported && <Alert tone="warning">This browser cannot speak questions aloud. Questions will be shown on screen only.</Alert>}
      {!recognitionSupported && (
        <Alert tone="warning" title="Live transcription is not available in this browser">
          You can still take the interview by typing your answers. For voice answers, use a recent Chrome or Edge.
        </Alert>
      )}
      <label className="checkbox">
        <input type="checkbox" checked={value.spoken && speaker.supported} disabled={!speaker.supported} onChange={(e) => set({ spoken: e.target.checked })} /> Read each question aloud
      </label>
      <div className="form-grid">
        <Field label="Interviewer voice">
          {(a11y) => (
            <select className="select" {...a11y} value={value.voiceURI} disabled={!speaker.supported || !value.spoken} onChange={(e) => set({ voiceURI: e.target.value })}>
              <option value="">Browser default</option>
              {(english.length ? english : voices).map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} ({v.lang})
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Answer language (for transcription)">
          {(a11y) => (
            <select className="select" {...a11y} value={value.lang} onChange={(e) => set({ lang: e.target.value })}>
              {RECOGNITION_LANGUAGES.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={`Speech rate · ${value.rate.toFixed(1)}×`}>
          {(a11y) => <input type="range" {...a11y} min={0.7} max={1.4} step={0.1} value={value.rate} disabled={!speaker.supported || !value.spoken} onChange={(e) => set({ rate: Number(e.target.value) })} style={{ accentColor: 'var(--accent)' }} />}
        </Field>
        <div className="field" style={{ justifyContent: 'flex-end' }}>
          <Button
            size="sm"
            disabled={!speaker.supported || !value.spoken}
            onClick={() => speaker.speak('Hello. I will read each interview question aloud like this.', { voice: voices.find((v) => v.voiceURI === value.voiceURI) || null, rate: value.rate, lang: value.lang })}
          >
            <Volume2 size={14} /> Preview voice
          </Button>
        </div>
      </div>
      <MicTest />
    </div>
  );
}

export function GuidedSetup({ resumes, availability, initial }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [cfg, setCfg] = useState({
    difficulty: 'Medium',
    questionCount: 10,
    category: initial.jobDescription ? 'Job Description-Based Interview' : initial.resumeId ? 'Resume-Based Interview' : 'Software Development / SDE',
    resumeId: initial.resumeId || '',
    jobDescription: initial.jobDescription || '',
    targetRole: initial.targetRole || '',
    company: '',
    language: '',
    durationMinutes: '',
    visualCoaching: false,
  });
  const [voice, setVoice] = useState(loadVoiceSettings);
  const [errors, setErrors] = useState({});
  const [creating, setCreating] = useState(false);
  const set = (patch) => setCfg((c) => ({ ...c, ...patch }));
  useEffect(() => saveVoiceSettings(voice), [voice]);
  useEffect(() => {
    if (initial.resumeId || initial.jobDescription) set({ resumeId: initial.resumeId || '', jobDescription: initial.jobDescription || '', targetRole: initial.targetRole || '' });
  }, [initial.resumeId, initial.jobDescription, initial.targetRole]); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = availability?.ready;
  const resumeTitle = resumes.find((r) => r._id === cfg.resumeId)?.title;

  const validate = () => {
    const e = {};
    if (cfg.category === 'Resume-Based Interview' && !cfg.resumeId) e.resumeId = 'Choose a resume for a resume-based interview';
    if (cfg.category === 'Job Description-Based Interview' && cfg.jobDescription.trim().length < 80) e.jobDescription = 'Paste the job description (at least 80 characters)';
    if (cfg.jobDescription.length > 20000) e.jobDescription = 'Job description must be at most 20,000 characters';
    return e;
  };

  const start = async (event) => {
    event.preventDefault();
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return;
    setCreating(true);
    try {
      const { session } = await api.post('/api/interviews', {
        mode: 'guided',
        difficulty: cfg.difficulty,
        category: cfg.category,
        questionCount: cfg.questionCount,
        ...(cfg.resumeId ? { resumeId: cfg.resumeId } : {}),
        jobDescription: cfg.jobDescription.trim(),
        targetRole: cfg.targetRole.trim(),
        company: cfg.company.trim(),
        language: cfg.language.trim(),
        ...(cfg.durationMinutes ? { durationMinutes: Number(cfg.durationMinutes) } : {}),
        visualCoaching: cfg.visualCoaching,
      });
      navigate(`/app/interviews/${session._id}/guided`);
    } catch (err) {
      setErrors(fieldErrors(err));
      toast.error(err.message);
      setCreating(false);
    }
  };

  return (
    <form className="setup-grid" onSubmit={start} noValidate>
      <div className="stack" style={{ gap: 20 }}>
        <section className="card" aria-labelledby="cfg-interview">
          <div className="card-header">
            <h2 id="cfg-interview">
              <Settings2 size={16} /> Interview settings
            </h2>
          </div>
          <div className="card-body stack" style={{ gap: 20 }}>
            <fieldset className="choice-group">
              <legend className="field-label">Difficulty</legend>
              <div className="choice-cards three">
                {DIFFICULTIES.map((d) => (
                  <label key={d.id} className={`choice-card${cfg.difficulty === d.id ? ' selected' : ''}`}>
                    <input type="radio" name="difficulty" value={d.id} checked={cfg.difficulty === d.id} onChange={() => set({ difficulty: d.id })} />
                    <b>{d.id}</b>
                    <span>{d.description}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="choice-group">
              <legend className="field-label">Number of questions</legend>
              <div className="segmented" role="radiogroup" aria-label="Number of questions">
                {QUESTION_COUNTS.map((n) => (
                  <button key={n} type="button" role="radio" aria-checked={cfg.questionCount === n} onClick={() => set({ questionCount: n })}>
                    {n} questions
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset className="choice-group">
              <legend className="field-label">Interview category</legend>
              <div className="category-grid">
                {CATEGORIES.map((c) => (
                  <label key={c} className={`category-chip${cfg.category === c ? ' selected' : ''}`}>
                    <input type="radio" name="category" value={c} checked={cfg.category === c} onChange={() => set({ category: c })} />
                    {c}
                  </label>
                ))}
              </div>
              {errors.category && <span className="field-error">{errors.category}</span>}
            </fieldset>
          </div>
        </section>

        <section className="card" aria-labelledby="cfg-personal">
          <div className="card-header">
            <h2 id="cfg-personal">
              <Sparkles size={16} /> Personalisation
            </h2>
            <span className="xsmall muted">All optional unless the category needs it</span>
          </div>
          <div className="card-body form-grid">
            <Field label="Resume" error={errors.resumeId} hint={resumes.length ? undefined : 'No saved resumes — questions will be general.'}>
              {(a11y) => (
                <select className="select" {...a11y} value={cfg.resumeId} onChange={(e) => set({ resumeId: e.target.value })}>
                  <option value="">None — general questions</option>
                  {resumes.map((r) => (
                    <option key={r._id} value={r._id}>
                      {r.title}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <TextField label="Target job title" value={cfg.targetRole} maxLength={120} placeholder="Backend Developer Intern" onChange={(e) => set({ targetRole: e.target.value })} />
            <TextField label="Company" value={cfg.company} maxLength={120} placeholder="Optional" onChange={(e) => set({ company: e.target.value })} />
            <TextField label="Programming language" value={cfg.language} maxLength={40} placeholder="e.g. Java, Python" onChange={(e) => set({ language: e.target.value })} />
            <Field label="Duration preference">
              {(a11y) => (
                <select className="select" {...a11y} value={cfg.durationMinutes} onChange={(e) => set({ durationMinutes: e.target.value })}>
                  <option value="">No preference</option>
                  {[15, 30, 45, 60].map((m) => (
                    <option key={m} value={m}>
                      About {m} minutes
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <div className="span-2">
              <TextField
                label="Job description"
                multiline
                rows={5}
                value={cfg.jobDescription}
                error={errors.jobDescription}
                placeholder="Paste the posting to tailor questions to it (optional)"
                onChange={(e) => set({ jobDescription: e.target.value })}
              />
            </div>
          </div>
        </section>

        <section className="card" aria-labelledby="cfg-voice">
          <div className="card-header">
            <h2 id="cfg-voice">
              <Volume2 size={16} /> Voice settings
            </h2>
            <span className="xsmall muted">Saved in this browser</span>
          </div>
          <div className="card-body">
            <VoiceSettings value={voice} onChange={setVoice} />
          </div>
        </section>
      </div>

      <aside className="stack setup-side" style={{ gap: 20 }}>
        <section className="card" aria-labelledby="cfg-privacy">
          <div className="card-header">
            <h2 id="cfg-privacy">
              <ShieldCheck size={16} /> Microphone & camera
            </h2>
          </div>
          <div className="card-body stack" style={{ gap: 14 }}>
            <div className="small" style={{ color: 'var(--text-2)' }}>
              <b style={{ display: 'block', color: 'var(--text)' }}>Microphone</b>
              Used for live transcription after each question. In Chrome and Edge the browser’s speech service (Google or Microsoft) processes your audio to produce the text. RoleFit saves only the final transcript you submit — no audio.
            </div>
            <label className="checkbox" style={{ alignItems: 'flex-start' }}>
              <input type="checkbox" checked={cfg.visualCoaching} onChange={(e) => set({ visualCoaching: e.target.checked })} />
              <span>
                <b style={{ display: 'block', color: 'var(--text)' }}>
                  <Camera size={13} style={{ verticalAlign: '-2px' }} /> Visual presentation coaching (optional)
                </b>
                <span className="small" style={{ color: 'var(--text-2)' }}>
                  Checks whether your face stays in frame and roughly faces the camera. Video is analysed only in this browser — never uploaded or recorded. It does not assess emotion, confidence or honesty.
                </span>
              </span>
            </label>
          </div>
        </section>

        <section className="card summary-card" aria-labelledby="cfg-summary">
          <div className="card-header">
            <h2 id="cfg-summary">Summary</h2>
          </div>
          <dl className="summary-list">
            <div>
              <dt>Category</dt>
              <dd>{cfg.category}</dd>
            </div>
            <div>
              <dt>Difficulty</dt>
              <dd>{cfg.difficulty}</dd>
            </div>
            <div>
              <dt>Questions</dt>
              <dd>{cfg.questionCount}</dd>
            </div>
            <div>
              <dt>Resume</dt>
              <dd>{resumeTitle || 'None'}</dd>
            </div>
            <div>
              <dt>Job description</dt>
              <dd>{cfg.jobDescription.trim() ? 'Provided' : 'Not provided'}</dd>
            </div>
            <div>
              <dt>Spoken questions</dt>
              <dd>{voice.spoken ? `On · ${voice.rate.toFixed(1)}×` : 'Off'}</dd>
            </div>
            <div>
              <dt>Camera coaching</dt>
              <dd>{cfg.visualCoaching ? 'On (asks permission)' : 'Off'}</dd>
            </div>
          </dl>
          <div className="card-footer" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            {!ready && <span className="xsmall muted">Unavailable until the AI service and Gemini are configured.</span>}
            <Button type="submit" variant="primary" size="lg" loading={creating} disabled={!ready}>
              <Play size={16} /> {creating ? 'Preparing questions…' : 'Start interview'}
            </Button>
          </div>
        </section>
      </aside>
    </form>
  );
}
