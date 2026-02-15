const express = require('express');
const router = express.Router();
const {
  bookRide,
  getMyRides,
  getRideById,
  cancelRide,
  rateRide,
} = require('../controllers/rideController');
const { protect, requireRole } = require('../middleware/authMiddleware');

router.post('/book', protect, requireRole('user'), bookRide);
router.get('/my-rides', protect, requireRole('user'), getMyRides);
router.get('/:id', protect, getRideById);
router.put('/:id/cancel', protect, requireRole('user'), cancelRide);
router.put('/:id/rate', protect, requireRole('user'), rateRide);

module.exports = router;
