// Gemini Live session over the authenticated Express relay.
// Browser mic -> 16 kHz PCM -> /ws/interview-live -> Python bridge -> Gemini Live,
// and Gemini native audio (24 kHz) + transcripts back. Owns every resource it
// creates (WebSocket, MediaStream, AudioContext, worklet) and releases them on stop/unmount.
import { useCallback, useEffect, useRef, useState } from 'react';
import { websocketUrl } from '../../lib/api.js';
import { createChunker, createPcmPlayer, downsample, pcmBase64 } from './audio.js';

const AUDIO_CONSTRAINTS = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

export function mediaErrorMessage(err) {
  if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') return 'Permission was denied. Click the camera/lock icon in your browser’s address bar, allow access, and try again.';
  if (err?.name === 'NotFoundError') return 'No microphone was found. Connect a microphone and try again.';
  if (err?.name === 'NotReadableError') return 'Your microphone or camera is being used by another application. Close it and try again.';
  return 'Your browser could not access the microphone. Use a recent version of Chrome or Edge.';
}

export function useLiveInterview({ sessionId, onTurnComplete, onReady }) {
  const [connection, setConnection] = useState('idle'); // idle | connecting | live | lost | error | closed
  const [aiSpeaking, setAiSpeaking] = useState(false);
  const [userTranscript, setUserTranscript] = useState('');
  const [aiTranscript, setAiTranscript] = useState('');
  const [error, setError] = useState('');
  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [stream, setStream] = useState(null);
  const [micLevel, setMicLevel] = useState(0); // 0..1, measured from the real input stream

  const wsRef = useRef(null);
  const ctxRef = useRef(null);
  const streamRef = useRef(null);
  const nodesRef = useRef([]);
  const playerRef = useRef(null);
  const chunkerRef = useRef(null);
  const userTurnRef = useRef('');
  const mutedRef = useRef(false);
  const endedRef = useRef(false);
  const readyRef = useRef(false);
  const levelRafRef = useRef(0);
  const callbacks = useRef({ onTurnComplete, onReady });
  callbacks.current = { onTurnComplete, onReady };

  const send = useCallback((obj) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }, []);

  const closeSocket = useCallback(() => {
    const ws = wsRef.current;
    wsRef.current = null;
    if (!ws) return;
    ws.onclose = null;
    ws.onmessage = null;
    ws.onerror = null;
    try {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'close' }));
      ws.close();
    } catch {
      /* already closed */
    }
  }, []);

  const connect = useCallback(() => {
    closeSocket();
    readyRef.current = false;
    setError('');
    setConnection('connecting');
    const ws = new WebSocket(websocketUrl(`/ws/interview-live?sessionId=${encodeURIComponent(sessionId)}`));
    wsRef.current = ws;

    ws.onmessage = (event) => {
      let m;
      try {
        m = JSON.parse(event.data);
      } catch {
        return;
      }
      switch (m.type) {
        case 'ready':
          readyRef.current = true;
          setConnection('live');
          callbacks.current.onReady?.();
          break;
        case 'user_transcript':
          userTurnRef.current = m.replace ? m.text || '' : userTurnRef.current + (m.text || '');
          setUserTranscript(userTurnRef.current);
          break;
        case 'monk_transcript':
          setAiTranscript((t) => (t + (m.text || '')).slice(-1500));
          break;
        case 'audio':
          try {
            playerRef.current?.play(m.data);
          } catch (err) {
            console.warn('Audio chunk skipped', err);
          }
          break;
        case 'interrupted':
          playerRef.current?.stop();
          break;
        case 'turn_complete':
          callbacks.current.onTurnComplete?.();
          break;
        case 'error':
          setError(m.message || 'The live AI session reported an error.');
          break;
        default:
          break;
      }
    };
    ws.onerror = () => {
      /* onclose follows with the useful state */
    };
    ws.onclose = (event) => {
      wsRef.current = null;
      playerRef.current?.stop();
      if (endedRef.current) return setConnection('closed');
      if (!readyRef.current) {
        setConnection('error');
        setError((e) =>
          e ||
          (event.code === 1006
            ? 'Could not open the live session. Check that the API and the AI service are running and that you are still signed in.'
            : 'The live session closed before it was ready.'),
        );
      } else {
        setConnection('lost');
      }
    };
  }, [closeSocket, sessionId]);

  /** Call from a click handler: acquires media, unlocks audio, then connects. */
  const start = useCallback(
    async ({ camera }) => {
      endedRef.current = false;
      setError('');
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser does not support microphone access. Use a recent Chrome or Edge.');
      let media;
      let cameraFailed = false;
      try {
        media = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: camera ? { facingMode: 'user' } : false });
      } catch (err) {
        if (!camera) throw new Error(mediaErrorMessage(err));
        // Camera is optional: fall back to microphone only.
        cameraFailed = true;
        try {
          media = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: false });
        } catch (micErr) {
          throw new Error(mediaErrorMessage(micErr));
        }
      }
      streamRef.current = media;
      setStream(media);
      setCameraOn(media.getVideoTracks().some((t) => t.readyState === 'live'));

      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      ctxRef.current = ctx;
      await ctx.resume();
      if (!ctx.audioWorklet) throw new Error('This browser does not support AudioWorklet, which live interviews need. Use a recent Chrome or Edge.');
      await ctx.audioWorklet.addModule(`${import.meta.env.BASE_URL}pcm-capture-worklet.js`);

      playerRef.current = createPcmPlayer(ctx, setAiSpeaking);
      chunkerRef.current = createChunker((chunk) => {
        if (!mutedRef.current) send({ type: 'audio', data: pcmBase64(chunk) });
      });
      const source = ctx.createMediaStreamSource(media);
      const node = new AudioWorkletNode(ctx, 'pcm-capture');
      const sink = ctx.createGain();
      sink.gain.value = 0;
      node.port.onmessage = (e) => {
        if (wsRef.current?.readyState !== WebSocket.OPEN || !readyRef.current) return;
        if (e.data instanceof Float32Array) chunkerRef.current.push(downsample(e.data, ctx.sampleRate));
      };
      source.connect(node);
      node.connect(sink);
      sink.connect(ctx.destination);

      // Input level meter: shows whether the microphone is actually picking up sound.
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      let lastPaint = 0;
      const tick = (t) => {
        levelRafRef.current = requestAnimationFrame(tick);
        if (t - lastPaint < 100) return;
        lastPaint = t;
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
        setMicLevel(mutedRef.current ? 0 : Math.min(1, Math.sqrt(sum / samples.length) * 6));
      };
      levelRafRef.current = requestAnimationFrame(tick);
      nodesRef.current = [source, node, sink, analyser];

      connect();
      return { cameraFailed };
    },
    [connect, send],
  );

  const stop = useCallback(() => {
    endedRef.current = true;
    cancelAnimationFrame(levelRafRef.current);
    setMicLevel(0);
    closeSocket();
    playerRef.current?.stop();
    nodesRef.current.forEach((n) => {
      try {
        n.disconnect();
      } catch {
        /* already disconnected */
      }
    });
    nodesRef.current = [];
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
    setCameraOn(false);
    const ctx = ctxRef.current;
    ctxRef.current = null;
    if (ctx && ctx.state !== 'closed') ctx.close().catch(() => {});
    setConnection((c) => (c === 'idle' ? c : 'closed'));
  }, [closeSocket]);

  useEffect(() => stop, [stop]);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      mutedRef.current = next;
      streamRef.current?.getAudioTracks().forEach((t) => (t.enabled = !next));
      if (next) chunkerRef.current?.reset();
      return next;
    });
  }, []);

  const toggleCamera = useCallback(() => {
    const tracks = streamRef.current?.getVideoTracks() || [];
    if (!tracks.length) return;
    const next = !tracks[0].enabled;
    tracks.forEach((t) => (t.enabled = next));
    setCameraOn(next);
  }, []);

  /** Returns the transcript of the candidate's current turn and starts a new one. */
  const takeUserTurn = useCallback(() => {
    const text = userTurnRef.current.trim();
    userTurnRef.current = '';
    setUserTranscript('');
    return text;
  }, []);

  /** Put a transcript back (e.g. when saving the answer failed). */
  const restoreUserTurn = useCallback((text) => {
    userTurnRef.current = text;
    setUserTranscript(text);
  }, []);

  return {
    connection,
    aiSpeaking,
    userTranscript,
    aiTranscript,
    clearAiTranscript: () => setAiTranscript(''),
    error,
    muted,
    cameraOn,
    micLevel,
    hasCamera: Boolean(stream?.getVideoTracks().length),
    stream,
    start,
    connect,
    stop,
    send,
    toggleMute,
    toggleCamera,
    takeUserTurn,
    restoreUserTurn,
  };
}
