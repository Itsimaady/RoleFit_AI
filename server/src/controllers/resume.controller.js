import { Resume } from '../models/Resume.js';
import { ApiError } from '../utils/errors.js';
import { resumeToText } from '../services/resumeText.js';
import { renderResumePdf, safeFilename } from '../services/pdf.service.js';
import { aiClient } from '../services/aiClient.js';
import { importedTextToResume } from '../services/resumeImport.js';

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Default DOCX layout (Python renderer) for each on-screen template.
const DOCX_LAYOUT = { classic: 'classic', modern: 'modern', compact: 'jake' };

async function findOwned(req, projection) {
  const resume = await Resume.findOne({ _id: req.valid.params.id, owner: req.user.id }, projection);
  // 404 (not 403) so other users' resource ids are not confirmed to exist.
  if (!resume) throw ApiError.notFound('Resume not found.');
  return resume;
}

export async function listResumes(req, res) {
  const { q, page, limit } = req.valid.query;
  const filter = { owner: req.user.id };
  if (q) filter.title = { $regex: escapeRegex(q), $options: 'i' };
  const [items, total] = await Promise.all([
    Resume.find(filter)
      .select('title template personal.fullName personal.headline revision createdAt updatedAt')
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Resume.countDocuments(filter),
  ]);
  res.json({ items, page, limit, total, pages: Math.ceil(total / limit) });
}

export async function createResume(req, res) {
  const resume = await Resume.create({ ...req.body, owner: req.user.id });
  res.status(201).json({ resume });
}

export async function getResume(req, res) {
  res.json({ resume: await findOwned(req) });
}

export async function updateResume(req, res) {
  const { revision, ...content } = req.body;
  const updated = await Resume.findOneAndUpdate(
    { _id: req.valid.params.id, owner: req.user.id, revision },
    { $set: content, $inc: { revision: 1 } },
    { new: true, runValidators: true },
  );
  if (updated) return res.json({ resume: updated });

  const current = await Resume.findOne({ _id: req.valid.params.id, owner: req.user.id }).select('revision').lean();
  if (!current) throw ApiError.notFound('Resume not found.');
  throw new ApiError(409, 'stale_revision', 'This resume was changed in another tab or device. Reload to get the latest version before saving.', {
    currentRevision: current.revision,
  });
}

export async function patchResume(req, res) {
  const resume = await Resume.findOneAndUpdate(
    { _id: req.valid.params.id, owner: req.user.id },
    { $set: req.body, $inc: { revision: 1 } },
    { new: true, runValidators: true },
  );
  if (!resume) throw ApiError.notFound('Resume not found.');
  res.json({ resume });
}

export async function deleteResume(req, res) {
  const result = await Resume.deleteOne({ _id: req.valid.params.id, owner: req.user.id });
  if (!result.deletedCount) throw ApiError.notFound('Resume not found.');
  res.status(204).end();
}

export async function duplicateResume(req, res) {
  const source = (await findOwned(req)).toObject();
  const strip = (items) => (items || []).map(({ _id, ...rest }) => rest);
  const copy = await Resume.create({
    owner: req.user.id,
    title: `Copy of ${source.title}`.slice(0, 100),
    template: source.template,
    personal: source.personal,
    summary: source.summary,
    education: strip(source.education),
    experience: strip(source.experience),
    projects: strip(source.projects),
    skills: source.skills,
    certifications: strip(source.certifications),
    achievements: strip(source.achievements),
    links: strip(source.links),
  });
  res.status(201).json({ resume: copy });
}

export async function exportPdf(req, res) {
  const resume = await findOwned(req);
  const pdf = await renderResumePdf(resume.toObject());
  res
    .status(200)
    .set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${safeFilename(resume.title)}.pdf"`,
      'Content-Length': pdf.length,
      'Cache-Control': 'no-store',
    })
    .send(pdf);
}

export async function exportDocx(req, res) {
  const resume = await findOwned(req);
  const layout = req.valid.query.layout || DOCX_LAYOUT[resume.template] || 'classic';
  const filename = safeFilename(resume.title);
  const docx = await aiClient.binary('/api/resume/generate', { resume_text: resumeToText(resume), template: layout, filename });
  res
    .status(200)
    .set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${filename}_${layout}.docx"`,
      'Content-Length': docx.length,
      'Cache-Control': 'no-store',
    })
    .send(docx);
}

export async function resumePlainText(req, res) {
  const resume = await findOwned(req);
  res.json({ text: resumeToText(resume) });
}

/** Upload PDF/DOCX/TXT -> parsed by the Python AI service -> new editable resume for review. */
export async function importResume(req, res) {
  const contentType = req.get('content-type') || '';
  if (!contentType.startsWith('multipart/form-data') || !Buffer.isBuffer(req.body) || !req.body.length) {
    throw ApiError.badRequest('Upload a PDF, DOCX or TXT file.');
  }
  const parsed = await aiClient.forwardMultipart('/api/resume/parse', req.body, contentType);
  const resume = await Resume.create({ ...importedTextToResume(parsed.text || '', parsed.structured || {}), owner: req.user.id });
  res.status(201).json({ resume, notice: 'Imported content was split into sections automatically. Please review every section before using it.' });
}
