import mongoose from 'mongoose';

const { Schema } = mongoose;

const suggestionSchema = new Schema(
  {
    id: String,
    category: String,
    severity: { type: String, enum: ['high', 'medium', 'low'] },
    title: String,
    detail: String,
    why: String,
  },
  { _id: false },
);

const evidenceSchema = new Schema(
  {
    skill: String,
    sources: [{ section: String, label: String, _id: false }],
  },
  { _id: false },
);

const emphasizeSchema = new Schema(
  {
    section: String,
    label: String,
    matchedSkills: [String],
  },
  { _id: false },
);

const jobAnalysisSchema = new Schema(
  {
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    resume: { type: Schema.Types.ObjectId, ref: 'Resume' },
    // Snapshot so history stays meaningful after the resume is edited or deleted.
    resumeSnapshot: {
      title: String,
      revision: Number,
      updatedAt: Date,
    },
    targetRole: { type: String, trim: true, maxlength: 120, default: '' },
    jobDescription: { type: String, required: true, maxlength: 20000 },
    scores: {
      skillCoverage: { type: Number, min: 0, max: 100 },
      keywordCoverage: { type: Number, min: 0, max: 100 },
    },
    matchedSkills: [String],
    missingSkills: [String],
    missingSkillPriorities: [{ skill: String, priority: { type: String, enum: ['required', 'preferred'] }, _id: false }],
    matchedKeywords: [String],
    missingKeywords: [String],
    relevantSkills: [String],
    evidence: [evidenceSchema],
    emphasize: [emphasizeSchema],
    suggestions: [suggestionSchema],
    checklist: [suggestionSchema],
    method: {
      name: String,
      version: String,
      description: String,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

jobAnalysisSchema.index({ owner: 1, createdAt: -1 });

export const JobAnalysis = mongoose.model('JobAnalysis', jobAnalysisSchema);
