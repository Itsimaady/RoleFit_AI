import express, { Router } from 'express';
import * as resumes from '../controllers/resume.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { aiLimiter } from '../middleware/rateLimiter.js';
import { idParams } from '../validators/common.js';
import {
  createResumeSchema,
  updateResumeSchema,
  patchResumeSchema,
  listResumesQuery,
  exportQuery,
} from '../validators/resume.validators.js';

const router = Router();
router.use(requireAuth);

router.get('/', validate({ query: listResumesQuery }), resumes.listResumes);
router.post('/', validate({ body: createResumeSchema }), resumes.createResume);
// Raw multipart body is forwarded to the AI service parser; 10 MB cap matches it.
router.post('/import', aiLimiter, express.raw({ type: 'multipart/form-data', limit: '10mb' }), resumes.importResume);
router.get('/:id', validate({ params: idParams }), resumes.getResume);
router.put('/:id', validate({ params: idParams, body: updateResumeSchema }), resumes.updateResume);
router.patch('/:id', validate({ params: idParams, body: patchResumeSchema }), resumes.patchResume);
router.delete('/:id', validate({ params: idParams }), resumes.deleteResume);
router.post('/:id/duplicate', validate({ params: idParams }), resumes.duplicateResume);
router.get('/:id/text', validate({ params: idParams }), resumes.resumePlainText);
router.get('/:id/export/pdf', validate({ params: idParams }), resumes.exportPdf);
router.get('/:id/export/docx', aiLimiter, validate({ params: idParams, query: exportQuery }), resumes.exportDocx);

export default router;
