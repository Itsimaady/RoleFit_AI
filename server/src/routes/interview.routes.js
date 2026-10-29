import { Router } from 'express';
import * as interviews from '../controllers/interview.controller.js';
import * as guided from '../controllers/guidedInterview.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { aiLimiter } from '../middleware/rateLimiter.js';
import { idParams } from '../validators/common.js';
import { createAnyInterviewSchema, answerSchema, listInterviewsQuery, guidedResponseSchema, responseParams, practiceSchema } from '../validators/interview.validators.js';

const router = Router();
router.use(requireAuth);

router.get('/availability', interviews.availability);
router.get('/', validate({ query: listInterviewsQuery }), interviews.listInterviews);
router.post('/', aiLimiter, validate({ body: createAnyInterviewSchema }), (req, res) => (req.body.mode === 'guided' ? guided.createGuidedInterview(req, res) : interviews.createInterview(req, res)));
router.get('/:id', validate({ params: idParams }), interviews.getInterview);
router.delete('/:id', validate({ params: idParams }), interviews.deleteInterview);
router.post('/:id/answers', aiLimiter, validate({ params: idParams, body: answerSchema }), interviews.submitAnswer);
router.post('/:id/complete', aiLimiter, validate({ params: idParams }), interviews.completeInterview);
// Guided voice interview
router.post('/:id/responses', aiLimiter, validate({ params: idParams, body: guidedResponseSchema }), guided.submitGuidedResponse);
router.post('/:id/responses/:index/evaluate', aiLimiter, validate({ params: responseParams }), guided.retryEvaluation);
router.post('/:id/learning', aiLimiter, validate({ params: idParams }), guided.regenerateLearning);
router.post('/:id/practice', aiLimiter, validate({ params: idParams, body: practiceSchema }), guided.startPractice);
router.get('/:id/report.pdf', validate({ params: idParams }), guided.downloadReportPdf);
router.post('/:id/abandon', validate({ params: idParams }), interviews.abandonInterview);

export default router;
