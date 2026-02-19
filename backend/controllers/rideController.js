const Ride = require('../models/Ride');
const Driver = require('../models/Driver');
const { getFareQuotes, toPositiveNumber, toNonNegativeNumber } = require('../utils/pricing');
const { haversineDistanceKm, normalizePoint, isValidLatLng } = require('../utils/geo');
const { getRequestExpiryDate, expireRequestedRides } = require('../services/rideLifecycleService');

const randomDistanceKm = () => {
  const minKm = 2;
  const maxKm = 22;
  return Math.floor(Math.random() * (maxKm - minKm + 1)) + minKm;
};

const normalizeDistanceKm = ({ distance, pickup, dropoff }) => {
  const parsedDistance = Number(distance);
  if (Number.isFinite(parsedDistance) && parsedDistance > 0) {
    return Number(parsedDistance.toFixed(2));
  }

  const haversine = haversineDistanceKm(pickup, dropoff);
  if (Number.isFinite(haversine) && haversine > 0) {
    return Number(haversine.toFixed(2));
  }

  return randomDistanceKm();
};

const normalizeDurationMinutes = ({ estimatedDuration, distanceKm }) => {
  const parsedDuration = Number(estimatedDuration);
  if (Number.isFinite(parsedDuration) && parsedDuration > 0) {
    return Math.round(parsedDuration);
  }

  return Math.max(5, Math.round(distanceKm * 3));
};

const canMutateRequestedRide = (ride) =>
  ride.status === 'requested' &&
  !ride.driverId &&
  ride.requestExpiresAt &&
  ride.requestExpiresAt.getTime() > Date.now();

const sanitizeRideForDriver = (rideDocOrObject) => {
  if (!rideDocOrObject) return rideDocOrObject;
  const ride = typeof rideDocOrObject.toObject === 'function'
    ? rideDocOrObject.toObject()
    : { ...rideDocOrObject };
  delete ride.pickupOtp;
  return ride;
};

// @desc    Get dynamic fare quotes
// @route   POST /api/rides/quote
// @access  Private (user)
const getFareQuote = async (req, res) => {
  try {
    const distanceKm = toPositiveNumber(req.body?.distance, 0);
    const durationMin = toPositiveNumber(req.body?.estimatedDuration, 0);
    const userPriceAddon = toNonNegativeNumber(req.body?.userPriceAddon, 0);

    if (!distanceKm || !durationMin) {
      return res.status(400).json({ message: 'Distance and estimated duration are required' });
    }

    const quotes = getFareQuotes({ distanceKm, durationMin, userPriceAddon });
    return res.json({ quotes });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to generate fare quote', error: error.message });
  }
};

// @desc    Book a new ride
// @route   POST /api/rides/book
// @access  Private (user)
const bookRide = async (req, res) => {
  try {
    const {
      pickup,
      dropoff,
      rideType,
      paymentMethod,
      distance,
      estimatedDuration,
      userPriceAddon,
    } = req.body;

    const pickupPoint = normalizePoint(pickup);
    const dropoffPoint = normalizePoint(dropoff);

    if (!pickupPoint.address || !dropoffPoint.address) {
      return res.status(400).json({ message: 'Pickup and dropoff addresses are required' });
    }

    if (pickupPoint.address.toLowerCase() === dropoffPoint.address.toLowerCase()) {
      return res.status(400).json({ message: 'Pickup and dropoff cannot be the same' });
    }

    await expireRequestedRides();

    const existingActiveRide = await Ride.findOne({
      userId: req.user._id,
      status: { $in: ['requested', 'accepted', 'in_progress'] },
    }).sort({ createdAt: -1 });

    if (existingActiveRide) {
      return res.status(400).json({
        message: 'You already have an active ride. Complete or cancel it before booking another.',
        rideId: existingActiveRide._id,
      });
    }

    const distanceKm = normalizeDistanceKm({
      distance,
      pickup: pickupPoint,
      dropoff: dropoffPoint,
    });
    const estimatedDurationMinutes = normalizeDurationMinutes({
      estimatedDuration,
      distanceKm,
    });
    const normalizedAddon = toNonNegativeNumber(userPriceAddon, 0);

    const ride = new Ride({
      userId: req.user._id,
      pickup: pickupPoint,
      dropoff: dropoffPoint,
      rideType: rideType || 'economy',
      paymentMethod: paymentMethod || 'cash',
      distance: distanceKm,
      estimatedDuration: estimatedDurationMinutes,
      userPriceAddon: normalizedAddon,
      status: 'requested',
      requestExpiresAt: getRequestExpiryDate(new Date()),
      userLiveLocation: {
        address: pickupPoint.address,
        lat: pickupPoint.lat,
        lng: pickupPoint.lng,
        updatedAt: new Date(),
      },
    });

    ride.calculateFare();
    await ride.save();

    return res.status(201).json({
      message: 'Ride booked successfully',
      ride,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to book ride', error: error.message });
  }
};

// @desc    Update user fare add-on while waiting
// @route   PUT /api/rides/:id/addon
// @access  Private (user)
const updateRideAddon = async (req, res) => {
  try {
    await expireRequestedRides();

    const ride = await Ride.findById(req.params.id);
    if (!ride) return res.status(404).json({ message: 'Ride not found' });
    if (ride.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    if (!canMutateRequestedRide(ride)) {
      return res.status(400).json({ message: 'Can update price only during active 5-minute wait window' });
    }

    const absoluteAddon = toNonNegativeNumber(req.body?.userPriceAddon, NaN);
    const incrementBy = toNonNegativeNumber(req.body?.incrementBy, NaN);

    if (Number.isFinite(absoluteAddon)) {
      ride.userPriceAddon = absoluteAddon;
    } else if (Number.isFinite(incrementBy) && incrementBy > 0) {
      ride.userPriceAddon = Number(ride.userPriceAddon || 0) + incrementBy;
    } else {
      return res.status(400).json({ message: 'Provide userPriceAddon or incrementBy' });
    }

    ride.calculateFare();
    await ride.save();

    return res.json({
      message: 'Ride price updated successfully',
      ride,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update ride price', error: error.message });
  }
};

// @desc    Update user live location for active ride
// @route   PUT /api/rides/:id/user-location
// @access  Private (user)
const updateUserLiveLocation = async (req, res) => {
  try {
    const ride = await Ride.findById(req.params.id);
    if (!ride) return res.status(404).json({ message: 'Ride not found' });
    if (ride.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    if (!['requested', 'accepted', 'in_progress'].includes(ride.status)) {
      return res.status(400).json({ message: `Cannot update location when ride is ${ride.status}` });
    }

    const lat = Number(req.body?.lat);
    const lng = Number(req.body?.lng);
    const address = String(req.body?.address || '').trim();
    if (!isValidLatLng({ lat, lng })) {
      return res.status(400).json({ message: 'Valid lat/lng are required' });
    }

    ride.userLiveLocation = {
      address,
      lat,
      lng,
      updatedAt: new Date(),
    };
    await ride.save();

    return res.json({ message: 'User location updated', ride });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update location', error: error.message });
  }
};

// @desc    Get all rides for logged-in user
// @route   GET /api/rides/my-rides
// @access  Private (user)
const getMyRides = async (req, res) => {
  try {
    await expireRequestedRides();

    const rides = await Ride.find({ userId: req.user._id })
      .populate('driverId', 'vehicleInfo rating userId currentLocation')
      .populate({ path: 'driverId', populate: { path: 'userId', select: 'name phone' } })
      .sort({ createdAt: -1 });

    return res.json({ rides });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch rides', error: error.message });
  }
};

// @desc    Get a single ride by ID
// @route   GET /api/rides/:id
// @access  Private
const getRideById = async (req, res) => {
  try {
    await expireRequestedRides();

    const ride = await Ride.findById(req.params.id)
      .populate('userId', 'name phone email')
      .populate({ path: 'driverId', populate: { path: 'userId', select: 'name phone' } });

    if (!ride) {
      return res.status(404).json({ message: 'Ride not found' });
    }

    const isOwner = ride.userId._id.toString() === req.user._id.toString();
    const isDriver = req.user.role === 'driver';
    if (!isOwner && !isDriver) {
      return res.status(403).json({ message: 'Not authorized to view this ride' });
    }

    if (isDriver) {
      return res.json({ ride: sanitizeRideForDriver(ride) });
    }

    return res.json({ ride });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch ride', error: error.message });
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
    ride.cancelledAt = new Date();
    ride.cancelledReason = 'Cancelled by user';
    await ride.save();

    return res.json({ message: 'Ride cancelled successfully', ride });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to cancel ride', error: error.message });
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

    return res.json({ message: 'Ride rated successfully', ride });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to rate ride', error: error.message });
  }
};

module.exports = {
  getFareQuote,
  bookRide,
  updateRideAddon,
  updateUserLiveLocation,
  getMyRides,
  getRideById,
  cancelRide,
  rateRide,
};
