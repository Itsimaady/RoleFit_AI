// Pure measurement helpers for optional visual presentation coaching.
// Only observable framing and head orientation are measured — never emotion,
// confidence, honesty or anything psychological.

/** One frame of face landmarks (normalised 0..1) -> observable cues, or null when no face. */
export function measureFrame(landmarks) {
  if (!landmarks?.length) return { face: false };
  let minX = 1;
  let maxX = 0;
  let minY = 1;
  let maxY = 0;
  for (const p of landmarks) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const inFrame = minX >= 0.02 && maxX <= 0.98 && minY >= 0.02 && maxY <= 0.98;
  // Yaw proxy: nose tip offset from the midpoint between the outer eye corners,
  // relative to eye distance. ~0 when facing the camera.
  const left = landmarks[33];
  const right = landmarks[263];
  const nose = landmarks[1];
  let facing = null;
  if (left && right && nose) {
    const span = Math.abs(right.x - left.x);
    if (span > 0.01) facing = Math.abs((nose.x - (left.x + right.x) / 2) / span) < 0.22;
  }
  return { face: true, inFrame, facing };
}

/** Accumulates per-question statistics from frame measurements. */
export function createSegmentStats({ lookAwayFrames = 3 } = {}) {
  let samples = 0;
  let withFace = 0;
  let inFrame = 0;
  let facingKnown = 0;
  let facing = 0;
  let awayStreak = 0;
  let lookAwayEvents = 0;
  return {
    add(m) {
      samples += 1;
      if (!m.face) {
        awayStreak = 0;
        return;
      }
      withFace += 1;
      if (m.inFrame) inFrame += 1;
      if (m.facing !== null && m.facing !== undefined) {
        facingKnown += 1;
        if (m.facing) {
          facing += 1;
          awayStreak = 0;
        } else {
          awayStreak += 1;
          if (awayStreak === lookAwayFrames) lookAwayEvents += 1; // count each sustained look-away once
        }
      }
    },
    result() {
      const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
      return {
        samples,
        // Face visible and fully inside the frame, out of all samples. If no face was
        // ever detected the cue could not be measured (camera covered, model failure),
        // so it is reported as unavailable rather than as 0%.
        faceInFramePct: withFace ? pct(inFrame, samples) : null,
        // Among samples where head orientation could be measured.
        facingCameraPct: pct(facing, facingKnown),
        lookAwayEvents,
        faceDetectedPct: samples ? pct(withFace, samples) : null,
      };
    },
  };
}
