const express = require('express');
const router = express.Router();
const {
  getDriverProfile,
  updateAvailability,
  updateLocation,
  getAvailableRides,
  acceptRide,
  updateRideStatus,
  getDriverRides,
} = require('../controllers/driverController');
const { protect, requireRole } = require('../middleware/authMiddleware');

router.get('/profile', protect, requireRole('driver'), getDriverProfile);
router.put('/availability', protect, requireRole('driver'), updateAvailability);
router.put('/location', protect, requireRole('driver'), updateLocation);
router.get('/available-rides', protect, requireRole('driver'), getAvailableRides);
router.put('/accept-ride/:rideId', protect, requireRole('driver'), acceptRide);
router.put('/update-ride/:rideId', protect, requireRole('driver'), updateRideStatus);
router.get('/my-rides', protect, requireRole('driver'), getDriverRides);

module.exports = router;
