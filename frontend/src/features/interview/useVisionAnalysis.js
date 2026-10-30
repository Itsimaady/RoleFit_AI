// Browser-local presentation signals using MediaPipe (ported from the original
// interview screen). Frames never leave the device. Unlike the original, a
// metric is only recorded when a face/pose is actually detected — no default
// values are substituted for frames where nothing was measured.
import { useCallback, useEffect, useRef, useState } from 'react';

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const POSE_MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task';
const KEYS = ['facial', 'eyeContact', 'posture', 'bodyMovement'];
const clamp = (v) => Math.round(Math.max(0, Math.min(100, v)));

function measure(face, pose, previousShoulders) {
  const out = {};
  const lm = face.faceLandmarks?.[0];
  if (lm) {
    const bs = face.faceBlendshapes?.[0]?.categories || [];
    const get = (n) => bs.find((x) => x.categoryName === n)?.score || 0;
    const smile = Math.max(get('mouthSmileLeft'), get('mouthSmileRight'));
    const blink = (get('eyeBlinkLeft') + get('eyeBlinkRight')) / 2;
    const brow = (get('browOuterUpLeft') + get('browOuterUpRight')) / 2;
    out.facial = clamp(55 + smile * 30 + (1 - blink) * 12 + brow * 8);
    const left = lm[33];
    const right = lm[263];
    const nose = lm[1];
    const span = Math.max(0.01, Math.abs(right.x - left.x));
    out.eyeContact = clamp(100 - Math.abs((nose.x - (left.x + right.x) / 2) / span) * 170);
  }
  let shoulders = null;
  const pl = pose.landmarks?.[0];
  if (pl) {
    const [ls, rs, lh, rh] = [pl[11], pl[12], pl[23], pl[24]];
    const tilt = Math.abs(ls.y - rs.y);
    const torso = (lh.y + rh.y) / 2 - (ls.y + rs.y) / 2;
    out.posture = clamp(100 - tilt * 300 - Math.abs(torso - 0.25) * 80);
    shoulders = { lsx: ls.x, rsx: rs.x, lsy: ls.y, rsy: rs.y };
    if (previousShoulders) {
      const motion = Math.abs(ls.x - previousShoulders.lsx) + Math.abs(rs.x - previousShoulders.rsx) + Math.abs(ls.y - previousShoulders.lsy) + Math.abs(rs.y - previousShoulders.rsy);
      out.bodyMovement = clamp(100 - motion * 180);
    }
  }
  return { metrics: out, shoulders };
}

const emptyTotals = () => Object.fromEntries(KEYS.map((k) => [k, { sum: 0, n: 0 }]));

export function useVisionAnalysis(videoRef, enabled) {
  const [status, setStatus] = useState('idle'); // idle | loading | running | unavailable
  const [metrics, setMetrics] = useState({});
  const modelsRef = useRef(null);
  const totalsRef = useRef(emptyTotals());
  const shouldersRef = useRef(null);
  const samplesRef = useRef(0);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    let timer = null;

    const start = async () => {
      setStatus('loading');
      try {
        if (!modelsRef.current) {
          const { FaceLandmarker, PoseLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
          const vision = await FilesetResolver.forVisionTasks(WASM_URL);
          const [face, pose] = await Promise.all([
            FaceLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'GPU' }, runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true }),
            PoseLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: POSE_MODEL, delegate: 'GPU' }, runningMode: 'VIDEO', numPoses: 1 }),
          ]);
          modelsRef.current = { face, pose };
        }
        if (cancelled) return;
        setStatus('running');
        timer = setInterval(() => {
          const video = videoRef.current;
          if (!video || video.readyState < 2) return;
          try {
            const now = performance.now();
            const { metrics: m, shoulders } = measure(modelsRef.current.face.detectForVideo(video, now), modelsRef.current.pose.detectForVideo(video, now), shouldersRef.current);
            shouldersRef.current = shoulders;
            samplesRef.current += 1;
            for (const [k, v] of Object.entries(m)) {
              totalsRef.current[k].sum += v;
              totalsRef.current[k].n += 1;
            }
            // Show "not detected" for metrics missing in this frame.
            setMetrics(Object.fromEntries(KEYS.map((k) => [k, m[k] ?? null])));
          } catch (err) {
            console.warn('Vision frame skipped', err);
          }
        }, 500);
      } catch (err) {
        console.warn('Presentation analysis unavailable', err);
        if (!cancelled) setStatus('unavailable');
      }
    };
    start();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      setStatus((s) => (s === 'unavailable' ? s : 'idle'));
    };
  }, [enabled, videoRef]);

  // Release WASM resources on unmount.
  useEffect(
    () => () => {
      try {
        modelsRef.current?.face.close();
        modelsRef.current?.pose.close();
      } catch {
        /* already closed */
      }
      modelsRef.current = null;
    },
    [],
  );

  /** Start averaging for a new answer. */
  const beginSegment = useCallback(() => {
    totalsRef.current = emptyTotals();
    samplesRef.current = 0;
  }, []);

  /** Averages since beginSegment(); null for anything never detected. */
  const segmentAverages = useCallback(() => {
    const out = { samples: samplesRef.current };
    for (const k of KEYS) {
      const { sum, n } = totalsRef.current[k];
      out[k] = n ? Math.round(sum / n) : null;
    }
    return out;
  }, []);

  return { status, metrics, beginSegment, segmentAverages };
}
