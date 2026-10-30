import { Router } from 'express';
import * as analyses from '../controllers/analysis.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { analysisLimiter } from '../middleware/rateLimiter.js';
import { idParams } from '../validators/common.js';
import { createAnalysisSchema, listAnalysesQuery } from '../validators/analysis.validators.js';

const router = Router();
router.use(requireAuth);

router.get('/', validate({ query: listAnalysesQuery }), analyses.listAnalyses);
router.post('/', analysisLimiter, validate({ body: createAnalysisSchema }), analyses.createAnalysis);
router.get('/:id', validate({ params: idParams }), analyses.getAnalysis);
router.delete('/:id', validate({ params: idParams }), analyses.deleteAnalysis);

export default router;
