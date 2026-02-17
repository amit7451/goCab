const Driver = require('../models/Driver');
const Ride = require('../models/Ride');
const { expireRequestedRides } = require('../services/rideLifecycleService');
const { haversineDistanceKm, isValidLatLng } = require('../utils/geo');

const DEFAULT_MATCH_RADIUS_KM = Number(process.env.DRIVER_MATCH_RADIUS_KM || 8);
const MAX_MATCH_RADIUS_KM = 20;
const ALL_CATEGORIES = ['economy', 'comfort', 'premium'];

const getDriverCategories = (driver) => {
  const categories = driver?.vehicleInfo?.categories;
  if (Array.isArray(categories) && categories.length) return categories;
  return ALL_CATEGORIES;
};

const getRideDispatchRadiusKm = (ride) => {
  const addonBoost = Math.floor(Number(ride?.userPriceAddon || 0) / 80);
  return Math.min(MAX_MATCH_RADIUS_KM, DEFAULT_MATCH_RADIUS_KM + addonBoost);
};

const generatePickupOtp = () => String(Math.floor(1000 + Math.random() * 9000));

const sanitizeRideForDriver = (rideDocOrObject) => {
  if (!rideDocOrObject) return rideDocOrObject;
  const ride = typeof rideDocOrObject.toObject === 'function'
    ? rideDocOrObject.toObject()
    : { ...rideDocOrObject };
  delete ride.pickupOtp;
  return ride;
};

// @desc    Get driver profile
// @route   GET /api/driver/profile
// @access  Private (driver)
const getDriverProfile = async (req, res) => {
  try {
    const driver = await Driver.findOne({ userId: req.user._id }).populate(
      'userId',
      'name email phone'
    );

    if (!driver) {
      return res.status(404).json({ message: 'Driver profile not found' });
    }

    return res.json({ driver });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch driver profile', error: error.message });
  }
};

// @desc    Update driver availability
// @route   PUT /api/driver/availability
// @access  Private (driver)
const updateAvailability = async (req, res) => {
  try {
    const { isAvailable } = req.body;

    const driver = await Driver.findOne({ userId: req.user._id });
    if (!driver) return res.status(404).json({ message: 'Driver profile not found' });

    driver.isAvailable = !!isAvailable;
    await driver.save();

    return res.json({ message: `You are now ${driver.isAvailable ? 'online' : 'offline'}`, driver });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update availability', error: error.message });
  }
};

// @desc    Update driver current location
// @route   PUT /api/driver/location
// @access  Private (driver)
const updateLocation = async (req, res) => {
  try {
    const { address, lat, lng } = req.body;
    const nextLat = Number(lat);
    const nextLng = Number(lng);

    if (!isValidLatLng({ lat: nextLat, lng: nextLng })) {
      return res.status(400).json({ message: 'Valid lat/lng are required' });
    }

    const driver = await Driver.findOne({ userId: req.user._id });
    if (!driver) return res.status(404).json({ message: 'Driver not found' });

    driver.currentLocation = {
      address: String(address || '').trim(),
      lat: nextLat,
      lng: nextLng,
    };
    await driver.save();

    return res.json({ message: 'Location updated', driver });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update location', error: error.message });
  }
};

// @desc    Get nearby pending rides for this driver
// @route   GET /api/driver/available-rides
// @access  Private (driver)
const getAvailableRides = async (req, res) => {
  try {
    await expireRequestedRides();

    const driver = await Driver.findOne({ userId: req.user._id });
    if (!driver) return res.status(404).json({ message: 'Driver not found' });

    const driverCategories = getDriverCategories(driver);
    const driverCoords = driver.currentLocation;
    const hasDriverCoords = isValidLatLng(driverCoords);

    const rides = await Ride.find({
      status: 'requested',
      driverId: null,
      requestExpiresAt: { $gt: new Date() },
      rideType: { $in: driverCategories },
    })
      .populate('userId', 'name phone')
      .sort({ createdAt: -1 })
      .lean();

    const nearbyRides = rides
      .map((ride) => {
        const dispatchRadiusKm = getRideDispatchRadiusKm(ride);
        const pickupDistanceKm =
          hasDriverCoords && isValidLatLng(ride.pickup)
            ? haversineDistanceKm(driverCoords, ride.pickup)
            : null;
        const inRange =
          !hasDriverCoords || !Number.isFinite(pickupDistanceKm)
            ? true
            : pickupDistanceKm <= dispatchRadiusKm;

        return {
          ...ride,
          dispatchRadiusKm,
          pickupDistanceKm: Number.isFinite(pickupDistanceKm)
            ? Number(pickupDistanceKm.toFixed(2))
            : null,
          secondsLeft: ride.requestExpiresAt
            ? Math.max(0, Math.floor((new Date(ride.requestExpiresAt).getTime() - Date.now()) / 1000))
            : 0,
          inRange,
        };
      })
      .filter((ride) => ride.inRange)
      .sort((a, b) => {
        const aDist = Number.isFinite(a.pickupDistanceKm) ? a.pickupDistanceKm : 9999;
        const bDist = Number.isFinite(b.pickupDistanceKm) ? b.pickupDistanceKm : 9999;
        if (aDist !== bDist) return aDist - bDist;
        return b.fare - a.fare;
      });

    return res.json({ rides: nearbyRides });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch available rides', error: error.message });
  }
};

// @desc    Accept a ride atomically
// @route   PUT /api/driver/accept-ride/:rideId
// @access  Private (driver)
const acceptRide = async (req, res) => {
  try {
    await expireRequestedRides();

    const driver = await Driver.findOne({ userId: req.user._id });
    if (!driver) return res.status(404).json({ message: 'Driver profile not found' });
    if (!driver.isAvailable) {
      return res.status(400).json({ message: 'You are currently offline' });
    }

    const activeRideExists = await Ride.exists({
      driverId: driver._id,
      status: { $in: ['accepted', 'in_progress'] },
    });
    if (activeRideExists) {
      return res.status(400).json({ message: 'Complete your current ride first' });
    }

    const candidateRide = await Ride.findOne({
      _id: req.params.rideId,
      status: 'requested',
      driverId: null,
      requestExpiresAt: { $gt: new Date() },
    });

    if (!candidateRide) {
      return res.status(400).json({ message: 'Ride is no longer available' });
    }

    const driverCategories = getDriverCategories(driver);
    if (!driverCategories.includes(candidateRide.rideType)) {
      return res.status(400).json({ message: 'Ride category does not match your vehicle categories' });
    }

    if (isValidLatLng(driver.currentLocation) && isValidLatLng(candidateRide.pickup)) {
      const pickupDistanceKm = haversineDistanceKm(driver.currentLocation, candidateRide.pickup);
      const dispatchRadiusKm = getRideDispatchRadiusKm(candidateRide);
      if (Number.isFinite(pickupDistanceKm) && pickupDistanceKm > dispatchRadiusKm) {
        return res.status(400).json({ message: 'Ride is outside your dispatch range' });
      }
    }

    const acceptedRide = await Ride.findOneAndUpdate(
      {
        _id: req.params.rideId,
        status: 'requested',
        driverId: null,
        requestExpiresAt: { $gt: new Date() },
      },
      {
        $set: {
          driverId: driver._id,
          status: 'accepted',
          acceptedAt: new Date(),
          pickupOtp: generatePickupOtp(),
          pickupOtpGeneratedAt: new Date(),
          pickupOtpVerifiedAt: null,
        },
      },
      { new: true }
    ).populate('userId', 'name phone email');

    if (!acceptedRide) {
      return res.status(400).json({ message: 'Ride was accepted by another driver' });
    }

    driver.isAvailable = false;
    await driver.save();

    return res.json({
      message: 'Ride accepted successfully',
      ride: sanitizeRideForDriver(acceptedRide),
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to accept ride', error: error.message });
  }
};

// @desc    Verify passenger pickup OTP before trip start
// @route   PUT /api/driver/verify-pickup-otp/:rideId
// @access  Private (driver)
const verifyPickupOtp = async (req, res) => {
  try {
    const otp = String(req.body?.otp || '').trim();
    if (!/^\d{4}$/.test(otp)) {
      return res.status(400).json({ message: 'Enter a valid 4-digit OTP' });
    }

    const driver = await Driver.findOne({ userId: req.user._id });
    if (!driver) return res.status(404).json({ message: 'Driver not found' });

    const ride = await Ride.findById(req.params.rideId);
    if (!ride) return res.status(404).json({ message: 'Ride not found' });
    if (!ride.driverId || ride.driverId.toString() !== driver._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to verify this ride OTP' });
    }
    if (ride.status !== 'accepted') {
      return res.status(400).json({ message: `OTP can be verified only when ride is accepted` });
    }
    if (ride.pickupOtpVerifiedAt) {
      return res.json({ message: 'OTP already verified', ride: sanitizeRideForDriver(ride) });
    }

    if (!ride.pickupOtp || ride.pickupOtp !== otp) {
      return res.status(400).json({ message: 'Invalid OTP' });
    }

    ride.pickupOtpVerifiedAt = new Date();
    ride.pickupOtp = '';
    await ride.save();

    return res.json({ message: 'Passenger verified successfully', ride: sanitizeRideForDriver(ride) });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to verify OTP', error: error.message });
  }
};

// @desc    Update ride status (in_progress or completed)
// @route   PUT /api/driver/update-ride/:rideId
// @access  Private (driver)
const updateRideStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const allowedTransitions = { accepted: 'in_progress', in_progress: 'completed' };

    const driver = await Driver.findOne({ userId: req.user._id });
    if (!driver) return res.status(404).json({ message: 'Driver not found' });

    const ride = await Ride.findById(req.params.rideId);
    if (!ride) return res.status(404).json({ message: 'Ride not found' });

    if (ride.driverId.toString() !== driver._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to update this ride' });
    }

    if (allowedTransitions[ride.status] !== status) {
      return res.status(400).json({
        message: `Cannot transition from "${ride.status}" to "${status}"`,
      });
    }

    if (status === 'in_progress' && ride.pickupOtp && !ride.pickupOtpVerifiedAt) {
      return res.status(400).json({ message: 'Verify passenger OTP before starting trip' });
    }

    ride.status = status;
    if (status === 'in_progress') ride.startTime = new Date();
    if (status === 'completed') {
      ride.endTime = new Date();
      driver.isAvailable = true;
      driver.totalRides += 1;
      driver.earnings += ride.fare;
      await driver.save();
    }

    await ride.save();

    return res.json({ message: `Ride marked as ${status}`, ride: sanitizeRideForDriver(ride) });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update ride status', error: error.message });
  }
};

// @desc    Get all rides assigned to this driver
// @route   GET /api/driver/my-rides
// @access  Private (driver)
const getDriverRides = async (req, res) => {
  try {
    await expireRequestedRides();

    const driver = await Driver.findOne({ userId: req.user._id });
    if (!driver) return res.status(404).json({ message: 'Driver not found' });

    const rides = await Ride.find({ driverId: driver._id })
      .populate('userId', 'name phone email')
      .sort({ createdAt: -1 });

    return res.json({ rides: rides.map((ride) => sanitizeRideForDriver(ride)) });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch driver rides', error: error.message });
  }
};

module.exports = {
  getDriverProfile,
  updateAvailability,
  updateLocation,
  getAvailableRides,
  acceptRide,
  verifyPickupOtp,
  updateRideStatus,
  getDriverRides,
};
