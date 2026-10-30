import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Bot, Camera, CameraOff, Mic, MicOff, PhoneOff, RefreshCw, Repeat, ShieldCheck, Video } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useApiData } from '../../hooks/useApiData.js';
import { useToast } from '../../context/ToastContext.jsx';
import { Alert, Button, ConfirmDialog, ErrorState, Meter, PageLoader } from '../../components/ui.jsx';
import { useLiveInterview } from './useLiveInterview.js';
import { useVisionAnalysis } from './useVisionAnalysis.js';
import { deliveryHeuristic } from './audio.js';

const CONNECTION_TEXT = {
  idle: 'Not connected',
  connecting: 'Connecting to the AI interviewer…',
  live: 'Live',
  lost: 'Connection lost',
  error: 'Could not connect',
  closed: 'Session closed',
};

function Pill({ on, warn, children }) {
  return (
    <span className="pill">
      <span className={`dot ${warn ? 'warn' : on ? 'on' : 'off'}`} aria-hidden="true" />
      {children}
    </span>
  );
}

export function InterviewLivePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { data, error: loadError, loading, reload } = useApiData(`/api/interviews/${id}`);
  const session = data?.session;

  const [wantCamera, setWantCamera] = useState(true);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');
  const [answered, setAnswered] = useState(null); // number of answers stored on the server
  const [saving, setSaving] = useState(false);
  const [pendingAnswer, setPendingAnswer] = useState(null);
  const [lastFeedback, setLastFeedback] = useState(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [ending, setEnding] = useState(false);
  const videoRef = useRef(null);
  const answeredRef = useRef(0);
  const processingRef = useRef(false);
  const finishedRef = useRef(false);

  useEffect(() => {
    if (session && answered === null) {
      answeredRef.current = session.answers.length;
      setAnswered(session.answers.length);
    }
  }, [session, answered]);

  const total = session?.questions.length || 12;
  const currentIndex = Math.min(answered ?? 0, total - 1);
  const question = session?.questions[currentIndex];

  // The live session and vision analysis reference each other through refs so
  // callbacks always see the current instances.
  const liveRef = useRef(null);
  const visionRef = useRef(null);

  const finish = useCallback(async () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setEnding(true);
    try {
      liveRef.current?.send({ type: 'finish' });
      await api.post(`/api/interviews/${id}/complete`);
      liveRef.current?.stop();
      navigate(`/app/interviews/${id}`, { replace: true });
    } catch (err) {
      finishedRef.current = false;
      setEnding(false);
      toast.error(`The report could not be generated: ${err.message}`);
    }
  }, [id, navigate, toast]);

  const saveAnswer = useCallback(
    async (answer) => {
      const index = answeredRef.current;
      const measured = visionRef.current.segmentAverages();
      const payload = { index, answer, vision: { ...measured, communication: deliveryHeuristic(answer) } };
      setSaving(true);
      try {
        const res = await api.post(`/api/interviews/${id}/answers`, payload);
        answeredRef.current = res.answeredCount;
        setAnswered(res.answeredCount);
        setPendingAnswer(null);
        setLastFeedback(res.answer);
        visionRef.current.beginSegment();
        liveRef.current?.clearAiTranscript();
        if (res.answeredCount >= res.total) await finish();
        else liveRef.current?.send({ type: 'advance', index: res.answeredCount });
      } catch (err) {
        if (err.code === 'out_of_order') {
          // Another tab or a duplicate event already stored this answer; resync.
          reload();
        }
        setPendingAnswer(answer);
        toast.error(`Your answer could not be saved: ${err.message}`);
      } finally {
        setSaving(false);
      }
    },
    [id, finish, reload, toast],
  );

  // Gemini signals the end of each model turn. If the candidate spoke before it,
  // that speech is the answer to the current question (same rule as the original app).
  const onTurnComplete = useCallback(async () => {
    if (processingRef.current || finishedRef.current) return;
    const answer = liveRef.current?.takeUserTurn() || '';
    if (!answer) return;
    processingRef.current = true;
    try {
      await saveAnswer(answer);
    } finally {
      processingRef.current = false;
    }
  }, [saveAnswer]);

  const onReady = useCallback(() => visionRef.current?.beginSegment(), []);
  const live = useLiveInterview({ sessionId: id, onTurnComplete, onReady });
  liveRef.current = live;
  const vision = useVisionAnalysis(videoRef, live.hasCamera && live.connection === 'live');
  visionRef.current = vision;

  // Attach the camera stream to the preview.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = live.stream || null;
    if (live.stream) video.play().catch(() => {});
  }, [live.stream, live.connection]);

  const begin = async () => {
    setStarting(true);
    setStartError('');
    try {
      const { cameraFailed } = await live.start({ camera: wantCamera });
      if (cameraFailed) toast.info('Camera unavailable. Continuing with microphone only; presentation signals will not be measured.');
    } catch (err) {
      live.stop();
      setStartError(err.message);
    } finally {
      setStarting(false);
    }
  };

  const endInterview = async () => {
    setConfirmEnd(false);
    if ((answeredRef.current || 0) > 0) return finish();
    setEnding(true);
    try {
      await api.post(`/api/interviews/${id}/abandon`);
      live.stop();
      toast.info('Interview ended. No answers were recorded, so there is no report.');
      navigate('/app/interviews', { replace: true });
    } catch (err) {
      setEnding(false);
      toast.error(err.message);
    }
  };

  if (loading && !session) return <PageLoader label="Loading interview" />;
  if (loadError)
    return (
      <div className="page">
        <div className="card">
          <ErrorState error={loadError} onRetry={reload} />
        </div>
      </div>
    );
  if (session.mode === 'guided') return <Navigate to={`/app/interviews/${id}/guided`} replace />;
  if (session.status === 'completed') return <Navigate to={`/app/interviews/${id}`} replace />;
  if (session.status === 'abandoned')
    return (
      <div className="page">
        <Alert tone="info" title="This interview was ended early">
          It can no longer be continued. <Link to="/app/interviews">Set up a new interview</Link>.
        </Alert>
      </div>
    );

  const started = live.connection !== 'idle';
  const measuring = vision.status === 'running';

  const statusText = saving
    ? 'Saving and evaluating your answer…'
    : live.aiSpeaking
      ? 'The interviewer is speaking'
      : live.connection === 'live'
        ? live.muted
          ? 'You are muted — unmute to answer'
          : 'Listening — answer when you are ready'
        : CONNECTION_TEXT[live.connection];
  const levelBars = [0.15, 0.35, 0.55, 0.75].map((t) => Math.max(2, Math.min(12, ((live.micLevel - t * 0.6) / 0.4) * 12)));

  return (
    <div className="page page-wide">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div className="stack" style={{ gap: 6 }}>
          <Link to="/app/interviews" className="back-link">
            <ArrowLeft size={14} /> Mock interviews
          </Link>
          <h1 style={{ fontSize: 22, letterSpacing: '-0.02em' }}>{session.targetRole}</h1>
          <p className="small muted">
            {session.resumeTitle} · {session.questionSource === 'gemini' ? 'Questions generated by Gemini from your resume and the job' : 'Template questions (Gemini could not personalise them)'}
          </p>
        </div>
        <span className="pill light" role="status" aria-live="polite">
          <span className={`dot ${live.connection === 'live' ? 'on' : live.connection === 'connecting' ? 'warn' : 'off'}`} aria-hidden="true" /> {CONNECTION_TEXT[live.connection]}
        </span>
      </div>

      {!started ? (
        <div className="prejoin">
          <section className="card" aria-labelledby="before-start">
            <div className="card-header">
              <h2 id="before-start">
                <Video size={16} /> Ready when you are
              </h2>
              <span className="xsmall muted">{total} questions</span>
            </div>
            <div className="card-body stack" style={{ gap: 18 }}>
              <ul className="prejoin-steps">
                <li>
                  <Mic size={15} /> Your browser will ask for microphone access. It is required for the voice interview.
                </li>
                <li>
                  <Bot size={15} /> The AI interviewer asks each question out loud. Answer naturally; when you pause, it moves on.
                </li>
                <li>
                  <Repeat size={15} /> {session.answers.length > 0 ? `You have answered ${session.answers.length}. The interview resumes at question ${session.answers.length + 1}.` : 'You can ask it to repeat a question, mute, or end at any time.'}
                </li>
              </ul>
              <label className="checkbox">
                <input type="checkbox" checked={wantCamera} onChange={(e) => setWantCamera(e.target.checked)} /> Also use my camera for presentation signals (analysed only in this browser)
              </label>
              {startError && (
                <Alert tone="danger" title="Could not start">
                  {startError}
                </Alert>
              )}
            </div>
            <div className="card-footer" style={{ justifyContent: 'space-between' }}>
              <Button variant="ghost" onClick={() => setConfirmEnd(true)} disabled={starting}>
                End without starting
              </Button>
              <Button variant="primary" size="lg" onClick={begin} loading={starting}>
                <Mic size={17} /> {session.answers.length ? 'Resume interview' : 'Start interview'}
              </Button>
            </div>
          </section>
          <section className="card" aria-labelledby="privacy">
            <div className="card-header">
              <h2 id="privacy">
                <ShieldCheck size={16} /> Privacy and accuracy
              </h2>
            </div>
            <div className="card-body">
              <ul className="privacy-list">
                <li>
                  <span className="row-icon">
                    <Mic size={15} />
                  </span>
                  <div>
                    <b>Audio is streamed, not recorded</b>
                    <p>Your voice goes to Google Gemini Live through our server. Only the text transcript of each answer is saved.</p>
                  </div>
                </li>
                <li>
                  <span className="row-icon">
                    <Camera size={15} />
                  </span>
                  <div>
                    <b>Camera stays on this device</b>
                    <p>Frames are analysed in your browser to estimate eye contact, posture and steadiness. Nothing is uploaded.</p>
                  </div>
                </li>
                <li>
                  <span className="row-icon" style={{ background: 'var(--ai-soft)', color: 'var(--ai)' }}>
                    <Bot size={15} />
                  </span>
                  <div>
                    <b>Feedback is approximate</b>
                    <p>AI feedback is practice guidance, not an assessment of your ability or suitability for a job.</p>
                  </div>
                </li>
              </ul>
            </div>
          </section>
        </div>
      ) : (
        <div className="room">
          <div className="stack">
            <div className="stage">
              <div className="video-tile">
                {live.hasCamera ? (
                  <video ref={videoRef} muted playsInline aria-label="Your camera preview" style={{ opacity: live.cameraOn ? 1 : 0.12 }} />
                ) : (
                  <div className="stack" style={{ alignItems: 'center', gap: 8 }}>
                    <CameraOff size={30} />
                    <span className="small">Camera not in use</span>
                  </div>
                )}
                <div className="overlay">
                  <Pill on={!live.muted && live.connection === 'live'}>
                    {live.muted ? <MicOff size={12} /> : <Mic size={12} />}
                    {live.muted ? 'Muted' : 'Mic'}
                    {!live.muted && (
                      <span className="mic-level" aria-label={live.micLevel > 0.08 ? 'Sound detected' : 'No sound detected'}>
                        {levelBars.map((h, i) => (
                          <i key={i} style={{ height: h }} />
                        ))}
                      </span>
                    )}
                  </Pill>
                  {live.hasCamera && <Pill on={live.cameraOn}>{live.cameraOn ? 'Camera on' : 'Camera off'}</Pill>}
                  {live.hasCamera && (
                    <Pill on={measuring} warn={vision.status === 'loading'}>
                      {measuring ? 'Analysing locally' : vision.status === 'loading' ? 'Loading analysis…' : vision.status === 'unavailable' ? 'Analysis unavailable' : 'Analysis paused'}
                    </Pill>
                  )}
                </div>
              </div>
              <div className="controls" role="toolbar" aria-label="Interview controls">
                <Button onClick={live.toggleMute} aria-pressed={live.muted} disabled={live.connection !== 'live'}>
                  {live.muted ? <MicOff size={16} /> : <Mic size={16} />} {live.muted ? 'Unmute' : 'Mute'}
                </Button>
                <Button onClick={live.toggleCamera} aria-pressed={!live.cameraOn} disabled={!live.hasCamera}>
                  {live.cameraOn ? <Camera size={16} /> : <CameraOff size={16} />} {live.cameraOn ? 'Stop camera' : 'Start camera'}
                </Button>
                <Button onClick={() => live.send({ type: 'repeat', index: currentIndex })} disabled={live.connection !== 'live' || saving}>
                  <Repeat size={16} /> Repeat
                </Button>
                <Button variant="danger" onClick={() => setConfirmEnd(true)} loading={ending}>
                  <PhoneOff size={16} /> End
                </Button>
              </div>
            </div>
            {live.hasCamera && (
              <section className="card card-pad stack" aria-labelledby="signals" style={{ gap: 12 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <h2 id="signals" style={{ fontSize: 14 }}>
                    Presentation signals
                  </h2>
                  <span className="xsmall muted">Approximate · on-device</span>
                </div>
                <div className="metric-grid">
                  {[
                    ['Facial engagement', vision.metrics.facial],
                    ['Eye contact', vision.metrics.eyeContact],
                    ['Posture', vision.metrics.posture],
                    ['Steadiness', vision.metrics.bodyMovement],
                  ].map(([label, value]) => (
                    <div className="metric" key={label}>
                      <div className="metric-top">
                        <span>{label}</span>
                        <b className="tabular">{value == null ? 'not detected' : value}</b>
                      </div>
                      <Meter value={value ?? 0} label={label} />
                    </div>
                  ))}
                </div>
                <p className="xsmall muted">Estimated from face and shoulder landmarks. They do not measure personality, honesty or job suitability.</p>
              </section>
            )}
          </div>

          <div className="stack">
            {live.connection === 'lost' && (
              <Alert
                tone="warning"
                title="The live connection dropped"
                action={
                  <Button size="sm" variant="primary" onClick={live.connect}>
                    <RefreshCw size={14} /> Reconnect
                  </Button>
                }
              >
                Your saved answers are safe. Reconnecting resumes at question {currentIndex + 1}.
              </Alert>
            )}
            {(live.connection === 'error' || live.error) && (
              <Alert
                tone="danger"
                title="Live AI problem"
                action={
                  live.connection === 'error' && (
                    <Button size="sm" onClick={live.connect}>
                      Try again
                    </Button>
                  )
                }
              >
                {live.error || 'The live session could not be established.'}
              </Alert>
            )}
            <section className="card question-card" aria-labelledby="question-label">
              <div className="stack" style={{ gap: 8 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span id="question-label" className="section-title">
                    Question {currentIndex + 1} of {total}
                  </span>
                  {question?.round && <span className="badge">{question.round}</span>}
                </div>
                <div className="progress-dots" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={answered ?? 0} aria-label="Questions answered">
                  {Array.from({ length: total }, (_, i) => (
                    <i key={i} className={i < (answered ?? 0) ? 'done' : i === currentIndex ? 'current' : ''} />
                  ))}
                </div>
              </div>
              <p className="q" aria-live="polite">
                {question?.question}
              </p>
              <div className="speaker">
                <span className={`speaker-orb${live.aiSpeaking ? ' speaking' : ''}`} aria-hidden="true">
                  <Bot size={19} />
                </span>
                <div style={{ minWidth: 0 }}>
                  <b className="small">AI interviewer</b>
                  <div className="xsmall muted" aria-live="polite">
                    {statusText}
                  </div>
                </div>
              </div>
            </section>
            <section className="card card-pad stack" style={{ gap: 14 }} aria-label="Live transcripts">
              <div>
                <span className="transcript-label">
                  <Mic size={12} /> Your answer · live transcript
                </span>
                <div className="transcript" aria-live="polite">
                  {live.userTranscript || <span className="muted">Your words appear here as you speak.</span>}
                </div>
              </div>
              <div>
                <span className="transcript-label" style={{ color: 'var(--ai)' }}>
                  <Bot size={12} /> Interviewer
                </span>
                <div className="transcript ai">{live.aiTranscript || <span className="muted">The interviewer’s words appear here.</span>}</div>
              </div>
              {pendingAnswer && (
                <Alert
                  tone="warning"
                  title="Your last answer was not saved"
                  action={
                    <Button size="sm" variant="primary" onClick={() => saveAnswer(pendingAnswer)} loading={saving}>
                      Retry
                    </Button>
                  }
                >
                  The transcript is kept so you can retry without answering again.
                </Alert>
              )}
              {lastFeedback && (
                <p className="xsmall muted">
                  Answer {lastFeedback.index + 1} saved. {lastFeedback.aiUsed ? 'AI feedback' : 'Estimated feedback (AI unavailable)'} appears in your report at the end.
                </p>
              )}
            </section>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmEnd}
        title="End the interview?"
        confirmLabel={(answered ?? 0) > 0 ? 'End and see report' : 'End interview'}
        cancelLabel="Keep going"
        tone="danger"
        onConfirm={endInterview}
        onCancel={() => setConfirmEnd(false)}
      >
        <p>
          {(answered ?? 0) > 0
            ? `You have answered ${answered} of ${total} questions. Your report will cover those answers only.`
            : 'You have not answered any questions yet, so no report will be created and this session cannot be resumed.'}
        </p>
      </ConfirmDialog>
    </div>
  );
}
