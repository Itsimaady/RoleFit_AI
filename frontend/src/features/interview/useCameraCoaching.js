// Optional, consent-gated camera coaching. Frames stay in the browser; only
// aggregate per-question numbers are saved. All tracks stop on stop()/unmount.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createSegmentStats, measureFrame } from './speech/cameraCoaching.js';

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

export function useCameraCoaching() {
  const [status, setStatus] = useState('off'); // off | requesting | loading | active | denied | unavailable
  const [live, setLive] = useState(null); // latest frame measurement, for the on-screen indicator
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const modelRef = useRef(null);
  const timerRef = useRef(null);
  const segmentRef = useRef(createSegmentStats());

  const stop = useCallback(() => {
    clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setLive(null);
    setStatus((s) => (s === 'denied' || s === 'unavailable' ? s : 'off'));
  }, []);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('unavailable');
      return false;
    }
    setStatus('requesting');
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: false });
    } catch {
      setStatus('denied');
      return false;
    }
    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {});
    }
    setStatus('loading');
    try {
      if (!modelRef.current) {
        const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
        const vision = await FilesetResolver.forVisionTasks(WASM_URL);
        modelRef.current = await FaceLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'GPU' }, runningMode: 'VIDEO', numFaces: 1 });
      }
    } catch (err) {
      console.warn('Face landmark model unavailable', err);
      // Keep the preview but report that measurements are unavailable.
      setStatus('unavailable');
      return true;
    }
    if (!streamRef.current) return false; // stopped while loading
    setStatus('active');
    timerRef.current = setInterval(() => {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || !modelRef.current) return;
      try {
        const result = modelRef.current.detectForVideo(video, performance.now());
        const m = measureFrame(result.faceLandmarks?.[0]);
        segmentRef.current.add(m);
        setLive(m);
      } catch {
        /* skip frame */
      }
    }, 500);
    return true;
  }, []);

  // Attach the stream if the <video> mounts after start().
  const attach = useCallback((node) => {
    videoRef.current = node;
    if (node && streamRef.current) {
      node.srcObject = streamRef.current;
      node.play().catch(() => {});
    }
  }, []);

  useEffect(
    () => () => {
      clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      try {
        modelRef.current?.close();
      } catch {
        /* already closed */
      }
    },
    [],
  );

  const beginSegment = useCallback(() => {
    segmentRef.current = createSegmentStats();
  }, []);
  /** Per-question numbers, or undefined when nothing was measured. */
  const endSegment = useCallback(() => {
    const r = segmentRef.current.result();
    segmentRef.current = createSegmentStats();
    return r.samples ? { samples: r.samples, faceInFramePct: r.faceInFramePct, facingCameraPct: r.facingCameraPct, lookAwayEvents: r.lookAwayEvents } : undefined;
  }, []);

  return { status, live, attach, start, stop, beginSegment, endSegment, hasStream: () => Boolean(streamRef.current) };
}
