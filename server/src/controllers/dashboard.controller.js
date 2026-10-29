import { Resume } from '../models/Resume.js';
import { JobAnalysis } from '../models/JobAnalysis.js';
import { InterviewSession } from '../models/InterviewSession.js';

export async function dashboard(req, res) {
  const owner = req.user.id;
  const [resumeCount, analysisCount, interviewCount, completedInterviews, recentResumes, recentAnalyses, recentInterviews] = await Promise.all([
    Resume.countDocuments({ owner }),
    JobAnalysis.countDocuments({ owner }),
    InterviewSession.countDocuments({ owner }),
    InterviewSession.countDocuments({ owner, status: 'completed' }),
    Resume.find({ owner }).select('title template updatedAt personal.headline').sort({ updatedAt: -1 }).limit(4).lean(),
    JobAnalysis.find({ owner }).select('targetRole resumeSnapshot.title scores missingSkills createdAt').sort({ createdAt: -1 }).limit(4).lean(),
    InterviewSession.find({ owner }).select('targetRole status report.overall_score answers.index createdAt completedAt').sort({ createdAt: -1 }).limit(4).lean(),
  ]);

  // Real history only: scores of completed interviews in chronological order.
  const scored = await InterviewSession.find({ owner, status: 'completed', 'report.overall_score': { $type: 'number' } })
    .select('targetRole report.overall_score completedAt')
    .sort({ completedAt: 1 })
    .limit(20)
    .lean();

  const activity = [
    ...recentResumes.map((r) => ({ type: 'resume', id: r._id, label: `Updated resume "${r.title}"`, at: r.updatedAt })),
    ...recentAnalyses.map((a) => ({ type: 'analysis', id: a._id, label: `Analyzed ${a.targetRole || 'a job description'}`, at: a.createdAt })),
    ...recentInterviews.map((i) => ({ type: 'interview', id: i._id, label: `${i.status === 'completed' ? 'Completed' : 'Started'} a ${i.targetRole} mock interview`, at: i.completedAt || i.createdAt })),
  ]
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, 8);

  res.json({
    counts: { resumes: resumeCount, analyses: analysisCount, interviews: interviewCount, completedInterviews },
    recentResumes,
    recentAnalyses,
    recentInterviews: recentInterviews.map(({ answers, ...rest }) => ({ ...rest, answeredCount: answers?.length || 0 })),
    interviewScores: scored.map((s) => ({ id: s._id, targetRole: s.targetRole, score: s.report.overall_score, completedAt: s.completedAt })),
    activity,
  });
}
