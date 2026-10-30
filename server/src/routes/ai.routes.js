import { Router } from 'express';
import { rewriteBullet } from '../controllers/ai.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { aiLimiter } from '../middleware/rateLimiter.js';
import { rewriteSchema } from '../validators/interview.validators.js';

const router = Router();
router.use(requireAuth);

router.post('/rewrite-bullet', aiLimiter, validate({ body: rewriteSchema }), rewriteBullet);

export default router;
