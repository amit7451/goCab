import { Router } from 'express';
import { getMapsConfig } from '../controllers/mapsController';

const router = Router();

router.get('/config', getMapsConfig);

export default router;
