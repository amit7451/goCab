import { Router } from 'express';
import {
  getFareQuote,
  bookRide,
  updateRideAddon,
  updateUserLiveLocation,
  getMyRides,
  getRideById,
  cancelRide,
  rateRide,
} from '../controllers/rideController';
import { protect, requireRole } from '../middleware/authMiddleware';

const router = Router();

router.post('/quote', protect as any, requireRole('user') as any, getFareQuote as any);
router.post('/book', protect as any, requireRole('user') as any, bookRide as any);
router.get('/my-rides', protect as any, requireRole('user') as any, getMyRides as any);
router.put('/:id/addon', protect as any, requireRole('user') as any, updateRideAddon as any);
router.put('/:id/user-location', protect as any, requireRole('user') as any, updateUserLiveLocation as any);
router.get('/:id', protect as any, getRideById as any);
router.put('/:id/cancel', protect as any, requireRole('user') as any, cancelRide as any);
router.put('/:id/rate', protect as any, requireRole('user') as any, rateRide as any);

export default router;
