import { Router } from 'express';
import { health, aiHealth } from '../controllers/health.controller.js';

const router = Router();
router.get('/', health);
router.get('/ai', aiHealth);

export default router;
