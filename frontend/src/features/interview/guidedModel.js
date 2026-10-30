// Shared constants and pure helpers for the guided voice interview.

export const DIFFICULTIES = [
  { id: 'Easy', description: 'Fundamental concepts and introductory questions.' },
  { id: 'Medium', description: 'Practical technical questions and problem-solving.' },
  { id: 'Hard', description: 'Advanced concepts, deeper follow-ups, edge cases and trade-offs.' },
];

export const QUESTION_COUNTS = [5, 10, 15, 20];

export const CATEGORIES = [
  'General HR',
  'Behavioral',
  'Data Structures and Algorithms',
  'Software Development / SDE',
  'Backend Development',
  'Frontend Development',
  'Full-Stack Development',
  'AI / Machine Learning',
  'System Design',
  'Resume-Based Interview',
  'Job Description-Based Interview',
  'Mixed Interview',
];

export const RECOGNITION_LANGUAGES = [
  { id: 'en-IN', label: 'English (India)' },
  { id: 'en-US', label: 'English (US)' },
  { id: 'en-GB', label: 'English (UK)' },
];

export const STATUS_INFO = {
  answered: { label: 'Answered', tone: 'tone-success' },
  skipped_for_learning: { label: 'Skipped · learn later', tone: 'tone-ai' },
  answered_but_empty: { label: 'Empty answer', tone: 'tone-warning' },
  technical_error: { label: 'Technical problem', tone: 'tone-danger' },
};

const VOICE_KEY = 'rolefit-voice-settings';
export const DEFAULT_VOICE_SETTINGS = { spoken: true, voiceURI: '', rate: 1, lang: 'en-IN' };

/** Per-browser preferences only (voice list differs per device); never server data. */
export function loadVoiceSettings() {
  try {
    return { ...DEFAULT_VOICE_SETTINGS, ...JSON.parse(localStorage.getItem(VOICE_KEY) || '{}') };
  } catch {
    return { ...DEFAULT_VOICE_SETTINGS };
  }
}
export function saveVoiceSettings(settings) {
  try {
    localStorage.setItem(VOICE_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable */
  }
}

/** How the final transcript was produced, for honest evaluation context. */
export function inputMethodFor({ recognized, final, usedVoice }) {
  if (!usedVoice) return 'typed';
  return recognized.trim() === final.trim() ? 'voice' : 'voice_edited';
}

export const interviewPath = (s) =>
  s.mode === 'guided'
    ? s.status === 'ready' || s.status === 'in_progress'
      ? `/app/interviews/${s._id}/guided`
      : `/app/interviews/${s._id}`
    : s.status === 'ready' || s.status === 'in_progress'
      ? `/app/interviews/${s._id}/live`
      : `/app/interviews/${s._id}`;

export function scoreLabel(s) {
  if (s.status !== 'completed') return null;
  if (s.mode === 'guided') return s.report?.averageScore != null ? `${s.report.averageScore}/10` : null;
  return s.report?.overall_score != null ? `${s.report.overall_score}/100` : null;
}
