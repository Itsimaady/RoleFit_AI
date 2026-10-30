import { JobAnalysis } from '../models/JobAnalysis.js';
import { Resume } from '../models/Resume.js';
import { ApiError } from '../utils/errors.js';
import { analyzeResumeAgainstJob } from '../services/analysis.service.js';

export async function createAnalysis(req, res) {
  const { resumeId, jobDescription, targetRole } = req.body;
  const resume = await Resume.findOne({ _id: resumeId, owner: req.user.id }).lean();
  if (!resume) throw ApiError.notFound('Resume not found.');

  const result = analyzeResumeAgainstJob(resume, jobDescription, targetRole);
  const analysis = await JobAnalysis.create({
    owner: req.user.id,
    resume: resume._id,
    resumeSnapshot: { title: resume.title, revision: resume.revision, updatedAt: resume.updatedAt },
    targetRole,
    jobDescription,
    ...result,
  });
  res.status(201).json({ analysis });
}

export async function listAnalyses(req, res) {
  const { page, limit, resumeId } = req.valid.query;
  const filter = { owner: req.user.id, ...(resumeId ? { resume: resumeId } : {}) };
  const [items, total] = await Promise.all([
    JobAnalysis.find(filter)
      .select('targetRole resume resumeSnapshot scores matchedSkills missingSkills createdAt')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    JobAnalysis.countDocuments(filter),
  ]);
  res.json({ items, page, limit, total, pages: Math.ceil(total / limit) });
}

export async function getAnalysis(req, res) {
  const analysis = await JobAnalysis.findOne({ _id: req.valid.params.id, owner: req.user.id }).lean();
  if (!analysis) throw ApiError.notFound('Analysis not found.');
  res.json({ analysis });
}

export async function deleteAnalysis(req, res) {
  const result = await JobAnalysis.deleteOne({ _id: req.valid.params.id, owner: req.user.id });
  if (!result.deletedCount) throw ApiError.notFound('Analysis not found.');
  res.status(204).end();
}
