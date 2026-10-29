import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useBlocker, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ArrowRight, Bot, Camera, CheckCircle2, Mic, MicOff, Pause, Pencil, Play, RefreshCw, RotateCcw, SkipForward, Square, Volume2 } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useApiData } from '../../hooks/useApiData.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Alert, Badge, Button, ConfirmDialog, ErrorState, PageLoader } from '../../components/ui.jsx';
import { STATUS_INFO, inputMethodFor, loadVoiceSettings } from './guidedModel.js';
import { createSpeaker } from './speech/speaker.js';
import { ERROR_MESSAGES, createRecognitionController, getRecognitionClass } from './speech/recognitionController.js';
import { useCameraCoaching } from './useCameraCoaching.js';

const PHASE_LABEL = {
  ready: 'Ready to start',
  speaking: 'Interviewer speaking',
  listening: 'Listening to your answer',
  finalizing: 'Finalizing answer',
  review: 'Review your answer',
  evaluating: 'Evaluating answer',
  feedback: 'Feedback ready',
  paused: 'Paused',
  finishing: 'Preparing learning report',
};

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function useElapsed(running) {
  const [seconds, setSeconds] = useState(0);
  const reset = useCallback(() => setSeconds(0), []);
  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [running]);
  return [seconds, reset];
}

function FeedbackPanel({ response, onRetryEvaluation, retrying }) {
  if (response.status !== 'answered') return null;
  const e = response.evaluation;
  if (!e) {
    return (
      <Alert
        tone="warning"
        title="Your answer is saved, but evaluation is pending"
        action={
          <Button size="sm" onClick={onRetryEvaluation} loading={retrying}>
            <RefreshCw size={14} /> Retry evaluation
          </Button>
        }
      >
        {response.evaluationError || 'The AI could not evaluate it right now.'} You can continue — it can also be retried from the report.
      </Alert>
    );
  }
  return (
    <div className="feedback-panel ai-surface">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="ai-label">AI feedback · approximate</span>
        <span className="score-pill">{e.score}/10</span>
      </div>
      {e.strengths?.length > 0 && (
        <div>
          <b className="small">What you did well</b>
          <ul>
            {e.strengths.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </div>
      )}
      {e.improvements?.length > 0 && (
        <div>
          <b className="small">To improve</b>
          <ul>
            {e.improvements.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="xsmall muted">Missing concepts, a stronger example answer and topics to revise are in your final report.</p>
    </div>
  );
}

export function GuidedInterviewPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { data, error, loading, reload } = useApiData(`/api/interviews/${id}`);
  const session = data?.session;

  const voice = useMemo(loadVoiceSettings, []);
  const speaker = useMemo(() => createSpeaker(), []);
  const Recognition = useMemo(() => getRecognitionClass(), []);
  const camera = useCameraCoaching();

  const [phase, setPhase] = useState('ready');
  const [index, setIndex] = useState(null);
  const [responses, setResponses] = useState([]);
  const [draft, setDraft] = useState('');
  const [recognized, setRecognized] = useState('');
  const [usedVoice, setUsedVoice] = useState(false);
  const [rec, setRec] = useState({ status: 'idle', finalText: '', interim: '', error: null, errors: [], restarts: 0, limitReached: false });
  const [lastResponse, setLastResponse] = useState(null);
  const [retrying, setRetrying] = useState(false);
  const [pausedFrom, setPausedFrom] = useState(null);
  const [dialog, setDialog] = useState(null); // 'skip' | 'empty' | 'end'
  const [editing, setEditing] = useState(false);
  const [questionSeconds, resetQuestionTimer] = useElapsed(['speaking', 'listening', 'review', 'finalizing'].includes(phase));
  const [totalSeconds] = useElapsed(phase !== 'ready' && phase !== 'paused' && phase !== 'finishing');

  const tokenRef = useRef(0);
  const busyRef = useRef(false);
  const leavingRef = useRef(false);
  const ctrlRef = useRef(null);
  const recordingStartedRef = useRef(null);

  // One recognition controller per page; state mirrored into React.
  if (!ctrlRef.current && Recognition) {
    ctrlRef.current = createRecognitionController({ Recognition, lang: voice.lang, onChange: setRec, maxDurationMs: 8 * 60 * 1000 });
  }

  useEffect(() => {
    if (session && index === null) {
      setIndex(session.responses.length);
      setResponses(session.responses);
    }
  }, [session, index]);

  // Cleanup: no speech, recognition or camera may outlive the page.
  useEffect(
    () => () => {
      tokenRef.current++;
      speaker.cancel();
      ctrlRef.current?.abort();
      camera.stop();
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const total = session?.questions.length || 0;
  const question = session?.questions[index ?? 0];
  const activePhase = !['ready', 'finishing'].includes(phase);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => activePhase && !leavingRef.current && currentLocation.pathname !== nextLocation.pathname);

  const voiceObj = () => speaker.voices().find((v) => v.voiceURI === voice.voiceURI) || null;

  /** keep=true appends to the transcript; text (from the editor) replaces it first. */
  const startListening = useCallback(
    ({ keep, text }) => {
      if (!ctrlRef.current) {
        setPhase('review'); // typing fallback
        return;
      }
      if (keep && typeof text === 'string') ctrlRef.current.setText(text);
      else if (!keep) {
        setDraft('');
        setRecognized('');
      }
      recordingStartedRef.current ??= Date.now();
      try {
        ctrlRef.current.start({ keepExisting: keep });
        setUsedVoice(true);
        setPhase('listening');
      } catch (err) {
        toast.error(err.message);
        setPhase('review');
      }
    },
    [toast],
  );

  const askQuestion = useCallback(
    async (i, { replay = false } = {}) => {
      const mine = ++tokenRef.current;
      const q = session.questions[i];
      if (!replay) {
        setDraft('');
        setRecognized('');
        setUsedVoice(false);
        setEditing(false);
        setLastResponse(null);
        recordingStartedRef.current = null;
        resetQuestionTimer();
        camera.beginSegment();
      }
      if (voice.spoken && speaker.supported) {
        setPhase('speaking');
        const outcome = await speaker.speak(q.question, { voice: voiceObj(), rate: voice.rate, lang: voice.lang });
        if (mine !== tokenRef.current) return; // superseded by pause/skip/replay
        if (outcome === 'error') toast.info('The question could not be read aloud. It is shown on screen.');
      }
      if (mine !== tokenRef.current) return;
      startListening({ keep: replay });
    },
    [session, voice, speaker, startListening, resetQuestionTimer, camera, toast], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const begin = async () => {
    if (session.config?.visualCoaching) {
      const ok = await camera.start();
      if (!ok) toast.info('Camera coaching is unavailable (permission denied or no camera). The interview continues without it.');
    }
    askQuestion(index);
  };

  const stopAnswer = async () => {
    if (!ctrlRef.current) return;
    setPhase('finalizing');
    const snap = await ctrlRef.current.stop();
    setRecognized(snap.finalText);
    setDraft(snap.finalText);
    setPhase('review');
  };

  const retryAnswer = () => {
    tokenRef.current++;
    ctrlRef.current?.abort();
    startListening({ keep: false });
  };

  const replay = async () => {
    if (phase === 'listening') {
      const snap = await ctrlRef.current.stop();
      setDraft(snap.finalText);
      setRecognized(snap.finalText);
    }
    speaker.cancel();
    askQuestion(index, { replay: true });
  };

  const pause = async () => {
    tokenRef.current++;
    speaker.cancel();
    const from = phase;
    if (phase === 'listening') {
      const snap = await ctrlRef.current.stop();
      setDraft(snap.finalText);
      setRecognized(snap.finalText);
    }
    setPausedFrom(from);
    setPhase('paused');
  };

  const resume = () => {
    const from = pausedFrom;
    setPausedFrom(null);
    if (from === 'speaking') askQuestion(index, { replay: true });
    else if (from === 'listening') startListening({ keep: true });
    else setPhase(from || 'review');
  };

  const finish = useCallback(async () => {
    leavingRef.current = true;
    setPhase('finishing');
    speaker.cancel();
    ctrlRef.current?.abort();
    camera.stop();
    try {
      await api.post(`/api/interviews/${id}/complete`);
      navigate(`/app/interviews/${id}`, { replace: true });
    } catch (err) {
      leavingRef.current = false;
      setPhase('feedback');
      toast.error(`The report could not be prepared: ${err.message}`);
    }
  }, [id, navigate, speaker, camera, toast]);

  const goNext = useCallback(
    (nextIndex) => {
      if (nextIndex >= total) return finish();
      setIndex(nextIndex);
      askQuestion(nextIndex);
      return undefined;
    },
    [total, finish, askQuestion],
  );

  /** Saves the response for the current question. Only path that sends data. */
  const record = async (status, transcript) => {
    if (busyRef.current) return;
    busyRef.current = true;
    tokenRef.current++;
    speaker.cancel();
    ctrlRef.current?.abort();
    setDialog(null);
    setPhase(status === 'answered' ? 'evaluating' : 'finalizing');
    const recState = ctrlRef.current?.state;
    const body = {
      index,
      status,
      transcript: status === 'answered_but_empty' ? '' : transcript.trim(),
      inputMethod: inputMethodFor({ recognized, final: transcript, usedVoice }),
      recognition: { restarts: recState?.restarts || 0, errors: (recState?.errors || []).slice(0, 20) },
      durationSeconds: recordingStartedRef.current ? Math.round((Date.now() - recordingStartedRef.current) / 1000) : undefined,
      visual: camera.endSegment(),
    };
    try {
      const res = await api.post(`/api/interviews/${id}/responses`, body);
      setResponses((r) => [...r, res.response]);
      if (status === 'answered') {
        setLastResponse(res.response);
        setPhase('feedback');
      } else {
        goNext(index + 1);
      }
    } catch (err) {
      // Nothing is lost: the transcript stays in the editor for another attempt.
      toast.error(`Could not save this answer: ${err.message}`);
      if (err.code === 'out_of_order') reload();
      setPhase('review');
    } finally {
      busyRef.current = false;
    }
  };

  const submit = () => {
    const text = draft.trim();
    if (!text) return setDialog('empty');
    record('answered', text);
  };

  const requestSkip = async () => {
    let text = draft;
    if (phase === 'listening') {
      const snap = await ctrlRef.current.stop();
      text = snap.finalText;
      setDraft(text);
      setRecognized(text); // unedited speech, so it is not reported as a manual correction
    }
    speaker.cancel();
    tokenRef.current++;
    if (text.trim()) setDialog('skip');
    else record('skipped_for_learning', '');
  };

  const retryEvaluation = async () => {
    setRetrying(true);
    try {
      const res = await api.post(`/api/interviews/${id}/responses/${lastResponse.index}/evaluate`);
      setLastResponse(res.response);
      setResponses((r) => r.map((x) => (x.index === res.response.index ? res.response : x)));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRetrying(false);
    }
  };

  const endInterview = async () => {
    setDialog(null);
    tokenRef.current++;
    speaker.cancel();
    ctrlRef.current?.abort();
    if (responses.length) return finish();
    leavingRef.current = true;
    camera.stop();
    try {
      await api.post(`/api/interviews/${id}/abandon`);
    } catch {
      /* leaving anyway */
    }
    toast.info('Interview ended. Nothing was answered, so there is no report.');
    navigate('/app/interviews', { replace: true });
  };

  if (loading && !session) return <PageLoader label="Loading interview" />;
  if (error)
    return (
      <div className="page">
        <div className="card">
          <ErrorState error={error} onRetry={reload} />
        </div>
      </div>
    );
  if (session.mode !== 'guided') return <Navigate to={`/app/interviews/${id}/live`} replace />;
  if (session.status === 'completed') return <Navigate to={`/app/interviews/${id}`} replace />;
  if (session.status === 'abandoned')
    return (
      <div className="page">
        <Alert tone="info" title="This interview was ended">
          It can no longer be continued. <Link to="/app/interviews">Set up a new interview</Link>.
        </Alert>
      </div>
    );
  if (index === null) return <PageLoader label="Loading interview" />;

  const allDone = index >= total;
  const recError = rec.error ? ERROR_MESSAGES[rec.error] || `Speech recognition error: ${rec.error}` : null;
  const listening = phase === 'listening';
  const canAnswer = ['listening', 'review'].includes(phase);
  const statusClass = { speaking: 'speaking', listening: 'listening', evaluating: 'busy', finalizing: 'busy', finishing: 'busy', paused: 'paused' }[phase] || '';

  return (
    <div className="page page-wide guided-page">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div className="stack" style={{ gap: 6 }}>
          <Link to="/app/interviews" className="back-link">
            <ArrowLeft size={14} /> Mock interviews
          </Link>
          <h1 style={{ fontSize: 22, letterSpacing: '-0.02em' }}>{session.targetRole || session.config.category}</h1>
          <p className="small muted">
            {session.config.category} · {session.config.difficulty} · {total} question{total === 1 ? "" : "s"}{session.practiceKind ? ` · practice (${session.practiceKind === 'skipped' ? 'skipped questions' : 'weak answers'})` : ''}
          </p>
        </div>
        <div className="row">
          <span className="pill light tabular" title="Total time">
            ⏱ {fmt(totalSeconds)}
          </span>
          {phase !== 'ready' && phase !== 'finishing' && (
            <Button onClick={() => setDialog('end')}>
              <Square size={14} /> End interview
            </Button>
          )}
        </div>
      </div>

      {phase === 'ready' ? (
        <section className="card start-card" aria-labelledby="start-title">
          <div className="stack" style={{ gap: 10 }}>
            <h2 id="start-title" style={{ fontSize: 20 }}>
              {allDone ? 'All questions are done' : index > 0 ? `Resume at question ${index + 1} of ${total}` : 'Ready when you are'}
            </h2>
            <ul className="prejoin-steps">
              <li>
                <Volume2 size={15} /> {voice.spoken && speaker.supported ? 'Each question is read aloud and shown on screen.' : 'Questions are shown on screen (spoken questions are off or unsupported).'}
              </li>
              <li>
                <Mic size={15} />{' '}
                {Recognition ? 'When the question finishes, listening starts. Pause as long as you need — nothing is submitted until you click Stop Answer.' : 'Live transcription is not supported in this browser, so you will type your answers.'}
              </li>
              <li>
                <SkipForward size={15} /> Blank on a question? Skip it — it is not scored and you will get a full explanation in your report.
              </li>
              {session.config.visualCoaching && (
                <li>
                  <Camera size={15} /> Camera coaching is on: your browser will ask for camera access. Video stays on this device.
                </li>
              )}
            </ul>
          </div>
          <div className="row">
            {allDone ? (
              <Button variant="primary" size="lg" onClick={finish}>
                See report <ArrowRight size={16} />
              </Button>
            ) : (
              <Button variant="primary" size="lg" onClick={begin}>
                <Play size={16} /> {index > 0 ? 'Resume interview' : 'Start interview'}
              </Button>
            )}
          </div>
        </section>
      ) : (
        <div className="guided-room">
          <section className="card question-panel" aria-labelledby="q-label">
            <div className="question-top">
              <span id="q-label" className="section-title">
                Question {Math.min(index + 1, total)} of {total}
              </span>
              <span className={`phase-pill ${statusClass}`} role="status" aria-live="polite">
                <span className="dot" aria-hidden="true" /> {PHASE_LABEL[phase]}
              </span>
            </div>
            <div className="progress-dots" aria-hidden="true">
              {Array.from({ length: total }, (_, i) => {
                const r = responses.find((x) => x.index === i);
                return <i key={i} className={r ? (r.status === 'answered' ? 'done' : r.status === 'skipped_for_learning' ? 'skipped' : 'warn') : i === index ? 'current' : ''} />;
              })}
            </div>
            <p className="q">{question?.question}</p>
            <div className="row xsmall muted">
              {question?.category && <Badge>{question.category}</Badge>}
              {question?.topic && <Badge>{question.topic}</Badge>}
              <span className="tabular">This question · {fmt(questionSeconds)}</span>
            </div>

            {phase === 'feedback' && lastResponse ? (
              <div className="stack" style={{ gap: 14 }}>
                <div className="answer-box readonly">
                  <span className="transcript-label">Your submitted answer</span>
                  <p>{lastResponse.transcript}</p>
                </div>
                <FeedbackPanel response={lastResponse} onRetryEvaluation={retryEvaluation} retrying={retrying} />
                <div className="row" style={{ justifyContent: 'flex-end' }}>
                  <Button variant="primary" onClick={() => goNext(index + 1)}>
                    {index + 1 >= total ? 'Finish & see report' : 'Next question'} <ArrowRight size={15} />
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className={`answer-box${listening ? ' live' : ''}`}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span className="transcript-label">
                      {listening ? (
                        <>
                          <span className="rec-dot" aria-hidden="true" /> Recording · live transcript
                        </>
                      ) : Recognition ? (
                        'Your answer'
                      ) : (
                        'Type your answer'
                      )}
                    </span>
                    {phase === 'review' && usedVoice && !editing && (
                      <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                        <Pencil size={13} /> Edit transcript
                      </Button>
                    )}
                  </div>
                  {phase === 'review' && (editing || !usedVoice) ? (
                    <textarea
                      className="textarea answer-input"
                      value={draft}
                      rows={6}
                      maxLength={12000}
                      autoFocus
                      aria-label="Your answer"
                      placeholder={Recognition ? 'Correct the transcript, or type your answer…' : 'Type your answer here…'}
                      onChange={(e) => setDraft(e.target.value)}
                    />
                  ) : (
                    <p className="transcript-text" aria-live="polite">
                      {(listening ? rec.finalText : draft) || (listening && !rec.interim ? <span className="muted">Start speaking — your words appear here.</span> : null)}
                      {listening && rec.interim && <span className="interim"> {rec.interim}</span>}
                      {!listening && !draft && phase !== 'speaking' && <span className="muted">Nothing captured yet.</span>}
                      {phase === 'speaking' && <span className="muted">Listening begins when the interviewer finishes.</span>}
                    </p>
                  )}
                  {listening && rec.status === 'restarting' && <span className="xsmall muted">Reconnecting the microphone… keep talking.</span>}
                  {rec.limitReached && <span className="xsmall" style={{ color: 'var(--warning)' }}>Recording stopped at the 8-minute safety limit. Review and submit, or resume listening.</span>}
                </div>
                {recError && (
                  <Alert tone="danger" title="Listening problem">
                    {recError} Your transcript so far is kept.
                  </Alert>
                )}

                <div className="answer-controls" role="toolbar" aria-label="Answer controls">
                  {listening && (
                    <Button variant="primary" size="lg" onClick={stopAnswer}>
                      <Square size={15} /> Stop answer
                    </Button>
                  )}
                  {phase === 'review' && (
                    <Button variant="primary" size="lg" onClick={submit}>
                      <CheckCircle2 size={16} /> Submit answer
                    </Button>
                  )}
                  {phase === 'review' && Recognition && !recError?.includes('blocked') && (
                    <Button onClick={() => startListening({ keep: true, text: draft })}>
                      <Mic size={15} /> Resume listening
                    </Button>
                  )}
                  {canAnswer && Recognition && (
                    <Button onClick={retryAnswer}>
                      <RotateCcw size={15} /> Retry answer
                    </Button>
                  )}
                  {['speaking', 'listening', 'review'].includes(phase) && (
                    <Button onClick={replay}>
                      <Volume2 size={15} /> Replay question
                    </Button>
                  )}
                  {['speaking', 'listening', 'review'].includes(phase) && (
                    <Button onClick={pause}>
                      <Pause size={15} /> Pause
                    </Button>
                  )}
                  {phase === 'paused' && (
                    <Button variant="primary" onClick={resume}>
                      <Play size={15} /> Resume
                    </Button>
                  )}
                  {['speaking', 'listening', 'review', 'paused'].includes(phase) && (
                    <Button variant="ghost" onClick={requestSkip} className="skip-btn">
                      <SkipForward size={15} /> Skip question — learn this later
                    </Button>
                  )}
                </div>
                {recError && phase === 'review' && !draft.trim() && (
                  <p className="xsmall muted">
                    Microphone trouble? Type your answer above, or{' '}
                    <button type="button" className="link-button" onClick={() => record('technical_error', '')}>
                      record this question as a technical problem
                    </button>{' '}
                    (not counted as a skip or a wrong answer).
                  </p>
                )}
              </>
            )}
          </section>

          <aside className="stack" style={{ gap: 16 }}>
            {session.config.visualCoaching && (
              <section className="card camera-card" aria-label="Camera coaching">
                <div className="camera-frame">
                  <video ref={camera.attach} muted playsInline aria-label="Your camera preview" />
                  {camera.status !== 'active' && camera.status !== 'loading' && (
                    <div className="camera-overlay">
                      {camera.status === 'denied' ? 'Camera permission denied' : camera.status === 'unavailable' ? 'Measurements unavailable' : 'Camera off'}
                    </div>
                  )}
                </div>
                <div className="card-body small stack" style={{ gap: 6 }}>
                  <b>Visual presentation coaching</b>
                  <span className="muted xsmall">
                    {camera.status === 'active'
                      ? camera.live?.face
                        ? `${camera.live.inFrame ? 'Face in frame' : 'Move fully into frame'} · ${camera.live.facing === false ? 'turned away' : 'facing camera'}`
                        : 'No face detected'
                      : camera.status === 'loading'
                        ? 'Loading on-device model…'
                        : 'Not measuring'}
                  </span>
                  {camera.status === 'active' && (
                    <Button size="sm" onClick={camera.stop}>
                      Turn camera off
                    </Button>
                  )}
                </div>
              </section>
            )}
            <section className="card" aria-labelledby="progress-title">
              <div className="card-header">
                <h2 id="progress-title">Progress</h2>
                <span className="xsmall muted">
                  {responses.length}/{total}
                </span>
              </div>
              <ol className="q-progress">
                {session.questions.map((q, i) => {
                  const r = responses.find((x) => x.index === i);
                  const info = r ? STATUS_INFO[r.status] : null;
                  return (
                    <li key={i} className={i === index && !r ? 'current' : ''}>
                      <span className="n">{i + 1}</span>
                      <span className="t">{i <= index ? q.question : 'Upcoming question'}</span>
                      {info ? <Badge tone={info.tone}>{r.status === 'answered' && r.evaluation ? `${r.evaluation.score}/10` : info.label}</Badge> : null}
                    </li>
                  );
                })}
              </ol>
            </section>
            {phase === 'listening' && (
              <p className="xsmall muted" style={{ padding: '0 4px' }}>
                <MicOff size={12} style={{ verticalAlign: '-2px' }} /> Recognition accuracy depends on your browser, microphone, accent and background noise. You can edit the transcript before submitting.
              </p>
            )}
          </aside>
        </div>
      )}

      <ConfirmDialog
        open={dialog === 'skip'}
        title="Skip this question?"
        confirmLabel="Skip and keep what I said"
        cancelLabel="Back to the question"
        onConfirm={() => record('skipped_for_learning', draft)}
        onCancel={() => {
          setDialog(null);
          setPhase('review');
        }}
      >
        <p>It will not be scored. Your report will explain the answer in “Questions I need to learn”. Keeping your partial answer lets the explanation address it.</p>
        <div className="row" style={{ marginTop: 12 }}>
          <Button size="sm" onClick={() => record('skipped_for_learning', '')}>
            Skip and discard what I said
          </Button>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === 'empty'}
        title="No answer was captured"
        confirmLabel="Try again"
        cancelLabel="Close"
        onConfirm={() => {
          setDialog(null);
          if (Recognition) startListening({ keep: false });
          else setPhase('review');
        }}
        onCancel={() => setDialog(null)}
      >
        <p>Nothing was transcribed for this question. You can try answering again, skip it for learning, or record it as an empty answer.</p>
        <div className="row" style={{ marginTop: 12 }}>
          <Button size="sm" onClick={() => record('skipped_for_learning', '')}>
            <SkipForward size={14} /> Skip — learn later
          </Button>
          <Button size="sm" onClick={() => record('answered_but_empty', '')}>
            Record empty answer
          </Button>
          {recError && (
            <Button size="sm" onClick={() => record('technical_error', '')}>
              <AlertTriangle size={14} /> It was a technical problem
            </Button>
          )}
        </div>
      </ConfirmDialog>

      <ConfirmDialog open={dialog === 'end'} title="End the interview?" confirmLabel={responses.length ? 'End and see report' : 'End interview'} cancelLabel="Keep going" tone="danger" onConfirm={endInterview} onCancel={() => setDialog(null)}>
        <p>
          {responses.length
            ? `You have completed ${responses.length} of ${total} questions. The report will cover those; the rest are marked as not reached.`
            : 'Nothing has been answered yet, so no report will be created and this session cannot be resumed.'}
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={blocker.state === 'blocked'}
        title="Leave the interview?"
        confirmLabel="Leave"
        cancelLabel="Stay"
        onCancel={() => blocker.reset?.()}
        onConfirm={() => {
          tokenRef.current++;
          speaker.cancel();
          ctrlRef.current?.abort();
          camera.stop();
          blocker.proceed?.();
        }}
      >
        <p>Answers you already submitted are saved and you can resume later from Mock interviews. The answer in progress will be lost.</p>
      </ConfirmDialog>
    </div>
  );
}
