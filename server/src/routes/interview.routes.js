import { Router } from 'express';
import * as interviews from '../controllers/interview.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { aiLimiter } from '../middleware/rateLimiter.js';
import { idParams } from '../validators/common.js';
import { createInterviewSchema, answerSchema, listInterviewsQuery } from '../validators/interview.validators.js';

const router = Router();
router.use(requireAuth);

router.get('/availability', interviews.availability);
router.get('/', validate({ query: listInterviewsQuery }), interviews.listInterviews);
router.post('/', aiLimiter, validate({ body: createInterviewSchema }), interviews.createInterview);
router.get('/:id', validate({ params: idParams }), interviews.getInterview);
router.delete('/:id', validate({ params: idParams }), interviews.deleteInterview);
router.post('/:id/answers', aiLimiter, validate({ params: idParams, body: answerSchema }), interviews.submitAnswer);
router.post('/:id/complete', aiLimiter, validate({ params: idParams }), interviews.completeInterview);
router.post('/:id/abandon', validate({ params: idParams }), interviews.abandonInterview);

export default router;
