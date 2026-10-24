import { Router } from 'express';
import {
  getDriverProfile,
  updateAvailability,
  updateLocation,
  getAvailableRides,
  acceptRide,
  verifyPickupOtp,
  updateRideStatus,
  getDriverRides,
} from '../controllers/driverController';
import { protect, requireRole } from '../middleware/authMiddleware';

const router = Router();

router.get('/profile', protect as any, requireRole('driver') as any, getDriverProfile as any);
router.put('/availability', protect as any, requireRole('driver') as any, updateAvailability as any);
router.put('/location', protect as any, requireRole('driver') as any, updateLocation as any);
router.get('/available-rides', protect as any, requireRole('driver') as any, getAvailableRides as any);
router.put('/accept-ride/:rideId', protect as any, requireRole('driver') as any, acceptRide as any);
router.put('/verify-pickup-otp/:rideId', protect as any, requireRole('driver') as any, verifyPickupOtp as any);
router.put('/update-ride/:rideId', protect as any, requireRole('driver') as any, updateRideStatus as any);
router.get('/my-rides', protect as any, requireRole('driver') as any, getDriverRides as any);

export default router;
