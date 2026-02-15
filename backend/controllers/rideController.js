const Ride = require('../models/Ride');
const Driver = require('../models/Driver');

// Simulate distance calculation (in a real app use Google Maps API)
const calculateDistance = (pickup, dropoff) => {
  const randomKm = Math.floor(Math.random() * 20) + 2; // 2–22 km
  return randomKm;
};

// @desc    Book a new ride
// @route   POST /api/rides/book
// @access  Private (user)
const bookRide = async (req, res) => {
  try {
    const { pickup, dropoff, rideType, paymentMethod } = req.body;

    if (!pickup?.address || !dropoff?.address) {
      return res.status(400).json({ message: 'Pickup and dropoff addresses are required' });
    }

    const distance = calculateDistance(pickup, dropoff);

    const ride = new Ride({
      userId: req.user._id,
      pickup,
      dropoff,
      rideType: rideType || 'economy',
      paymentMethod: paymentMethod || 'cash',
      distance,
      status: 'requested',
    });

    ride.calculateFare();
    await ride.save();

    res.status(201).json({
      message: 'Ride booked successfully',
      ride,
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to book ride', error: error.message });
  }
};

// @desc    Get all rides for logged-in user
// @route   GET /api/rides/my-rides
// @access  Private (user)
const getMyRides = async (req, res) => {
  try {
    const rides = await Ride.find({ userId: req.user._id })
      .populate('driverId', 'vehicleInfo rating userId')
      .populate({ path: 'driverId', populate: { path: 'userId', select: 'name phone' } })
      .sort({ createdAt: -1 });

    res.json({ rides });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch rides', error: error.message });
  }
};

// @desc    Get a single ride by ID
// @route   GET /api/rides/:id
// @access  Private
const getRideById = async (req, res) => {
  try {
    const ride = await Ride.findById(req.params.id)
      .populate('userId', 'name phone email')
      .populate({ path: 'driverId', populate: { path: 'userId', select: 'name phone' } });

    if (!ride) {
      return res.status(404).json({ message: 'Ride not found' });
    }

    // Ensure the ride belongs to the requesting user or the assigned driver
    const isOwner = ride.userId._id.toString() === req.user._id.toString();
    const isDriver = req.user.role === 'driver';
    if (!isOwner && !isDriver) {
      return res.status(403).json({ message: 'Not authorized to view this ride' });
    }

    res.json({ ride });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch ride', error: error.message });
  }
};

// @desc    Cancel a ride (by user)
// @route   PUT /api/rides/:id/cancel
// @access  Private (user)
const cancelRide = async (req, res) => {
  try {
    const ride = await Ride.findById(req.params.id);

    if (!ride) {
      return res.status(404).json({ message: 'Ride not found' });
    }

    if (ride.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to cancel this ride' });
    }

    if (['completed', 'cancelled', 'in_progress'].includes(ride.status)) {
      return res.status(400).json({ message: `Cannot cancel a ride that is ${ride.status}` });
    }

    ride.status = 'cancelled';
    await ride.save();

    res.json({ message: 'Ride cancelled successfully', ride });
  } catch (error) {
    res.status(500).json({ message: 'Failed to cancel ride', error: error.message });
  }
};

// @desc    Rate a completed ride
// @route   PUT /api/rides/:id/rate
// @access  Private (user)
const rateRide = async (req, res) => {
  try {
    const { rating } = req.body;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ message: 'Rating must be between 1 and 5' });
    }

    const ride = await Ride.findById(req.params.id);

    if (!ride) return res.status(404).json({ message: 'Ride not found' });
    if (ride.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    if (ride.status !== 'completed') {
      return res.status(400).json({ message: 'Can only rate completed rides' });
    }
    if (ride.rating) {
      return res.status(400).json({ message: 'Ride already rated' });
    }

    ride.rating = rating;
    await ride.save();

    // Update driver rating
    if (ride.driverId) {
      const driver = await Driver.findById(ride.driverId);
      if (driver) {
        const newCount = driver.rating.count + 1;
        const newAvg =
          (driver.rating.average * driver.rating.count + rating) / newCount;
        driver.rating = { average: parseFloat(newAvg.toFixed(1)), count: newCount };
        await driver.save();
      }
    }

    res.json({ message: 'Ride rated successfully', ride });
  } catch (error) {
    res.status(500).json({ message: 'Failed to rate ride', error: error.message });
  }
};

module.exports = { bookRide, getMyRides, getRideById, cancelRide, rateRide };
