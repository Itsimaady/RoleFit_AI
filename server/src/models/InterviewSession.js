import mongoose from 'mongoose';

const { Schema } = mongoose;

export const INTERVIEW_STATUSES = ['ready', 'in_progress', 'completed', 'abandoned'];

const questionSchema = new Schema(
  {
    round: { type: String, maxlength: 60 },
    difficulty: { type: String, maxlength: 20 },
    question: { type: String, maxlength: 1000 },
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

const interviewSessionSchema = new Schema(
  {
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    resume: { type: Schema.Types.ObjectId, ref: 'Resume' },
    resumeTitle: { type: String, maxlength: 100 },
    // Plain-text resume used to personalize the interview (snapshot).
    resumeText: { type: String, maxlength: 30000, select: false },
    targetRole: { type: String, trim: true, maxlength: 120, required: true },
    jobDescription: { type: String, maxlength: 20000, required: true },
    config: {
      questionCount: { type: Number, default: 12 },
      mode: { type: String, default: 'gemini-live-voice' },
    },
    status: { type: String, enum: INTERVIEW_STATUSES, default: 'ready' },
    questions: [questionSchema],
    questionSource: { type: String, enum: ['gemini', 'fallback'] },
    answers: [answerSchema],
    report: { type: Schema.Types.Mixed },
    startedAt: Date,
    completedAt: Date,
  },
  { timestamps: true },
);

interviewSessionSchema.index({ owner: 1, createdAt: -1 });

export const InterviewSession = mongoose.model('InterviewSession', interviewSessionSchema);
