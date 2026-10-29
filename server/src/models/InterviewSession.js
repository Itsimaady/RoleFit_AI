import mongoose from 'mongoose';

const { Schema } = mongoose;

export const INTERVIEW_STATUSES = ['ready', 'in_progress', 'completed', 'abandoned'];
export const INTERVIEW_MODES = ['live', 'guided'];
// Guided-mode per-question outcomes. A skip is a deliberate learning choice and
// is never scored; a technical error is never recorded as a skip.
export const RESPONSE_STATUSES = ['answered', 'skipped_for_learning', 'answered_but_empty', 'technical_error'];
export const DIFFICULTIES = ['Easy', 'Medium', 'Hard'];
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

const questionSchema = new Schema(
  {
    round: { type: String, maxlength: 60 },
    difficulty: { type: String, maxlength: 20 },
    question: { type: String, maxlength: 1000 },
    category: { type: String, maxlength: 60 },
    topic: { type: String, maxlength: 80 },
  },
  { _id: false },
);

const answerSchema = new Schema(
  {
    index: { type: Number, min: 0 },
    round: String,
    question: String,
    // Live speech transcript (Gemini input transcription). Raw audio and
    // camera frames are never stored.
    answer: { type: String, maxlength: 20000 },
    score: { type: Number, min: 0, max: 100 },
    feedback: String,
    improvement: String,
    // Browser-local presentation measurements (averaged during the answer).
    vision: { type: Schema.Types.Mixed },
    presentation: { type: Schema.Types.Mixed },
    aiUsed: Boolean,
    evaluatedAt: Date,
  },
  { _id: false },
);

// Guided mode: one record per asked question, in order.
const responseSchema = new Schema(
  {
    index: { type: Number, min: 0, required: true },
    status: { type: String, enum: RESPONSE_STATUSES, required: true },
    transcript: { type: String, maxlength: 12000, default: '' },
    inputMethod: { type: String, enum: ['voice', 'typed', 'voice_edited'], default: 'voice' },
    // Speech-recognition health for this answer (measured in the browser).
    recognition: {
      restarts: { type: Number, min: 0, default: 0 },
      errors: { type: [String], default: [] },
    },
    durationSeconds: { type: Number, min: 0 },
    // Local camera coaching aggregates (no frames are ever sent).
    visual: {
      samples: { type: Number, min: 0 },
      faceInFramePct: { type: Number, min: 0, max: 100 },
      facingCameraPct: { type: Number, min: 0, max: 100 },
      lookAwayEvents: { type: Number, min: 0 },
    },
    evaluation: { type: Schema.Types.Mixed, default: null },
    evaluationError: { type: String, default: null },
    evaluatedAt: Date,
    learning: { type: Schema.Types.Mixed, default: null },
    learningError: { type: String, default: null },
  },
  { _id: false, timestamps: { createdAt: true, updatedAt: false } },
);

const interviewSessionSchema = new Schema(
  {
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    resume: { type: Schema.Types.ObjectId, ref: 'Resume' },
    resumeTitle: { type: String, maxlength: 100 },
    // Plain-text resume used to personalize the interview (snapshot).
    resumeText: { type: String, maxlength: 30000, select: false },
    mode: { type: String, enum: INTERVIEW_MODES, default: 'live' },
    targetRole: { type: String, trim: true, maxlength: 120, default: '' },
    jobDescription: { type: String, maxlength: 20000, default: '' },
    config: {
      questionCount: { type: Number, default: 12 },
      mode: { type: String, default: 'gemini-live-voice' },
      difficulty: { type: String, enum: DIFFICULTIES },
      category: { type: String, enum: CATEGORIES },
      company: { type: String, maxlength: 120 },
      language: { type: String, maxlength: 40 },
      durationMinutes: { type: Number, min: 5, max: 120 },
      visualCoaching: { type: Boolean, default: false },
    },
    status: { type: String, enum: INTERVIEW_STATUSES, default: 'ready' },
    questions: [questionSchema],
    questionSource: { type: String, enum: ['gemini', 'fallback'] },
    answers: [answerSchema],
    responses: [responseSchema],
    practiceOf: { type: Schema.Types.ObjectId, ref: 'InterviewSession' },
    practiceKind: { type: String, enum: ['skipped', 'weak'] },
    report: { type: Schema.Types.Mixed },
    startedAt: Date,
    completedAt: Date,
  },
  { timestamps: true },
);

interviewSessionSchema.index({ owner: 1, createdAt: -1 });

export const InterviewSession = mongoose.model('InterviewSession', interviewSessionSchema);
