const Driver = require('../models/Driver');
const Ride = require('../models/Ride');
const User = require('../models/User');

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

    res.json({ driver });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch driver profile', error: error.message });
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

    driver.isAvailable = isAvailable;
    await driver.save();

    res.json({ message: `You are now ${isAvailable ? 'online' : 'offline'}`, driver });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update availability', error: error.message });
  }
};

// @desc    Update driver current location
// @route   PUT /api/driver/location
// @access  Private (driver)
const updateLocation = async (req, res) => {
  try {
    const { address, lat, lng } = req.body;

    const driver = await Driver.findOne({ userId: req.user._id });
    if (!driver) return res.status(404).json({ message: 'Driver not found' });

    driver.currentLocation = { address, lat, lng };
    await driver.save();

    res.json({ message: 'Location updated', driver });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update location', error: error.message });
  }
};

// @desc    Get all pending (requested) rides available for pickup
// @route   GET /api/driver/available-rides
// @access  Private (driver)
const getAvailableRides = async (req, res) => {
  try {
    const rides = await Ride.find({ status: 'requested', driverId: null })
      .populate('userId', 'name phone')
      .sort({ createdAt: -1 });

    res.json({ rides });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch available rides', error: error.message });
  }
};

// @desc    Accept a ride
// @route   PUT /api/driver/accept-ride/:rideId
// @access  Private (driver)
const acceptRide = async (req, res) => {
  try {
    const driver = await Driver.findOne({ userId: req.user._id });
    if (!driver) return res.status(404).json({ message: 'Driver profile not found' });
    if (!driver.isAvailable) {
      return res.status(400).json({ message: 'You are currently offline' });
    }

    const ride = await Ride.findById(req.params.rideId);
    if (!ride) return res.status(404).json({ message: 'Ride not found' });
    if (ride.status !== 'requested') {
      return res.status(400).json({ message: 'Ride is no longer available' });
    }

    ride.driverId = driver._id;
    ride.status = 'accepted';
    await ride.save();

    driver.isAvailable = false;
    await driver.save();

    await ride.populate('userId', 'name phone email');

    res.json({ message: 'Ride accepted successfully', ride });
  } catch (error) {
    res.status(500).json({ message: 'Failed to accept ride', error: error.message });
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

    res.json({ message: `Ride marked as ${status}`, ride });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update ride status', error: error.message });
  }
};

// @desc    Get all rides assigned to this driver
// @route   GET /api/driver/my-rides
// @access  Private (driver)
const getDriverRides = async (req, res) => {
  try {
    const driver = await Driver.findOne({ userId: req.user._id });
    if (!driver) return res.status(404).json({ message: 'Driver not found' });

    const rides = await Ride.find({ driverId: driver._id })
      .populate('userId', 'name phone email')
      .sort({ createdAt: -1 });

    res.json({ rides });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch driver rides', error: error.message });
  }
};

module.exports = {
  getDriverProfile,
  updateAvailability,
  updateLocation,
  getAvailableRides,
  acceptRide,
  updateRideStatus,
  getDriverRides,
};
