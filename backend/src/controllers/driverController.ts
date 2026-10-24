import { Response } from 'express';
import mongoose from 'mongoose';
import Driver from '../models/Driver';
import Ride from '../models/Ride';
import { AuthRequest, IDriver, IRide, RideStatus, RideType } from '../types';
import { haversineDistanceKm, isValidLatLng } from '../utils/geo';
import { expireRequestedRides } from '../services/rideLifecycleService';
import { sanitizeRideForDriver } from './rideController';
import {
  emitRideAccepted,
  emitRideStatusChanged,
  getIO,
} from '../services/socketService';

const BASE_DISPATCH_RADIUS_KM = 8;
const MAX_DISPATCH_RADIUS_KM = 16;
const ADDON_KM_STEP = 50;

const getDriverCategories = (driver?: IDriver | null): RideType[] => {
  const configured = driver?.vehicleInfo?.categories;
  if (Array.isArray(configured) && configured.length > 0) {
    return configured;
  }
  return ['economy'];
};

const getRideDispatchRadiusKm = (ride: IRide): number => {
  const addon = Math.max(0, Number(ride.userPriceAddon || 0));
  const expandedRadius =
    BASE_DISPATCH_RADIUS_KM + Math.floor(addon / ADDON_KM_STEP) * 2;
  return Math.min(MAX_DISPATCH_RADIUS_KM, expandedRadius);
};

const generatePickupOtp = (): string => {
  return String(Math.floor(1000 + Math.random() * 9000));
};

// @desc    Get driver profile
// @route   GET /api/driver/profile
// @access  Private (driver)
export const getDriverProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Not authorized' });
      return;
    }

    const driver = await Driver.findOne({ userId: req.user._id }).populate(
      'userId',
      'name email phone'
    );

    if (!driver) {
      res.status(404).json({ message: 'Driver profile not found' });
      return;
    }

    res.json({ driver });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : 'Failed to fetch driver profile';
    res.status(500).json({ message: 'Failed to fetch driver profile', error: message });
  }
};

// @desc    Update driver availability
// @route   PUT /api/driver/availability
// @access  Private (driver)
export const updateAvailability = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Not authorized' });
      return;
    }

    const { isAvailable } = req.body;
    if (typeof isAvailable !== 'boolean') {
      res.status(400).json({ message: 'isAvailable must be a boolean' });
      return;
    }

    const driver = await Driver.findOne({ userId: req.user._id });
    if (!driver) {
      res.status(404).json({ message: 'Driver profile not found' });
      return;
    }

    driver.isAvailable = isAvailable;
    await driver.save();

    res.json({ message: `You are now ${isAvailable ? 'online' : 'offline'}`, driver });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : 'Failed to update availability';
    res.status(500).json({ message: 'Failed to update availability', error: message });
  }
};

// @desc    Update driver current location
// @route   PUT /api/driver/location
// @access  Private (driver)
export const updateLocation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Not authorized' });
      return;
    }

    const { address, lat, lng } = req.body;
    const numLat = Number(lat);
    const numLng = Number(lng);

    if (!isValidLatLng({ lat: numLat, lng: numLng })) {
      res.status(400).json({ message: 'Valid coordinates (-90 to 90 lat, -180 to 180 lng) are required' });
      return;
    }

    const driver = await Driver.findOne({ userId: req.user._id });
    if (!driver) {
      res.status(404).json({ message: 'Driver not found' });
      return;
    }

    driver.currentLocation = {
      address: String(address || '').trim(),
      lat: numLat,
      lng: numLng,
    };
    await driver.save();

    // Broadcast live location to any active ride in real time
    const activeRide = await Ride.findOne({
      driverId: driver._id,
      status: { $in: ['accepted', 'in_progress'] },
    });

    if (activeRide) {
      const io = getIO();
      io?.to(`ride:${activeRide._id.toString()}`).emit('driver:location_changed', {
        driverId: driver._id.toString(),
        lat: numLat,
        lng: numLng,
        address: driver.currentLocation.address,
        updatedAt: new Date().toISOString(),
      });
    }

    res.json({ message: 'Location updated', driver });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : 'Failed to update location';
    res.status(500).json({ message: 'Failed to update location', error: message });
  }
};

// @desc    Get all pending (requested) rides available for pickup
// @route   GET /api/driver/available-rides
// @access  Private (driver)
export const getAvailableRides = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Not authorized' });
      return;
    }

    await expireRequestedRides();

    const driver = await Driver.findOne({ userId: req.user._id });
    if (!driver) {
      res.status(404).json({ message: 'Driver profile not found' });
      return;
    }

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
      .map((ride: any) => {
        const dispatchRadiusKm = getRideDispatchRadiusKm(ride);
        const pickupDistanceKm =
          hasDriverCoords && isValidLatLng(ride.pickup)
            ? haversineDistanceKm(driverCoords, ride.pickup)
            : null;
        const inRange =
          !hasDriverCoords || !Number.isFinite(pickupDistanceKm)
            ? true
            : pickupDistanceKm! <= dispatchRadiusKm;

        return {
          ...ride,
          dispatchRadiusKm,
          pickupDistanceKm: Number.isFinite(pickupDistanceKm)
            ? Number(pickupDistanceKm!.toFixed(2))
            : null,
          secondsLeft: ride.requestExpiresAt
            ? Math.max(0, Math.floor((new Date(ride.requestExpiresAt).getTime() - Date.now()) / 1000))
            : 0,
          inRange,
        };
      })
      .filter((ride) => ride.inRange)
      .sort((a, b) => {
        const aDist = Number.isFinite(a.pickupDistanceKm) ? a.pickupDistanceKm! : 9999;
        const bDist = Number.isFinite(b.pickupDistanceKm) ? b.pickupDistanceKm! : 9999;
        if (aDist !== bDist) return aDist - bDist;
        return b.fare - a.fare;
      });

    res.json({ rides: nearbyRides });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : 'Failed to fetch available rides';
    res.status(500).json({ message: 'Failed to fetch available rides', error: message });
  }
};

// @desc    Accept a ride atomically
// @route   PUT /api/driver/accept-ride/:rideId
// @access  Private (driver)
export const acceptRide = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Not authorized' });
      return;
    }

    const { rideId } = req.params;
    if (!mongoose.isValidObjectId(rideId)) {
      res.status(400).json({ message: 'Invalid ride ID' });
      return;
    }

    await expireRequestedRides();

    const driver = await Driver.findOne({ userId: req.user._id });
    if (!driver) {
      res.status(404).json({ message: 'Driver profile not found' });
      return;
    }

    if (!driver.isAvailable) {
      res.status(400).json({ message: 'You are currently offline. Please go online first.' });
      return;
    }

    const activeRideExists = await Ride.exists({
      driverId: driver._id,
      status: { $in: ['accepted', 'in_progress'] },
    });
    if (activeRideExists) {
      res.status(400).json({ message: 'Complete your current ride first' });
      return;
    }

    const candidateRide = await Ride.findOne({
      _id: rideId,
      status: 'requested',
      driverId: null,
      requestExpiresAt: { $gt: new Date() },
    });

    if (!candidateRide) {
      res.status(400).json({ message: 'Ride is no longer available' });
      return;
    }

    const driverCategories = getDriverCategories(driver);
    if (!driverCategories.includes(candidateRide.rideType)) {
      res.status(400).json({ message: 'Ride category does not match your vehicle categories' });
      return;
    }

    if (isValidLatLng(driver.currentLocation) && isValidLatLng(candidateRide.pickup)) {
      const pickupDistanceKm = haversineDistanceKm(driver.currentLocation, candidateRide.pickup);
      const dispatchRadiusKm = getRideDispatchRadiusKm(candidateRide);
      if (Number.isFinite(pickupDistanceKm) && pickupDistanceKm! > dispatchRadiusKm) {
        res.status(400).json({ message: 'Ride is outside your dispatch range' });
        return;
      }
    }

    const acceptedRide = await Ride.findOneAndUpdate(
      {
        _id: rideId,
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
      res.status(400).json({ message: 'Ride was accepted by another driver' });
      return;
    }

    driver.isAvailable = false;
    await driver.save();

    // Broadcast real-time event so passenger and other drivers are updated immediately
    emitRideAccepted(acceptedRide, driver);

    res.json({
      message: 'Ride accepted successfully',
      ride: sanitizeRideForDriver(acceptedRide),
    });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : 'Failed to accept ride';
    res.status(500).json({ message: 'Failed to accept ride', error: message });
  }
};

// @desc    Verify passenger pickup OTP before trip start
// @route   PUT /api/driver/verify-pickup-otp/:rideId
// @access  Private (driver)
export const verifyPickupOtp = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Not authorized' });
      return;
    }

    const { rideId } = req.params;
    const otp = String(req.body?.otp || '').trim();

    if (!/^\d{4}$/.test(otp)) {
      res.status(400).json({ message: 'Enter a valid 4-digit OTP' });
      return;
    }

    if (!mongoose.isValidObjectId(rideId)) {
      res.status(400).json({ message: 'Invalid ride ID' });
      return;
    }

    const driver = await Driver.findOne({ userId: req.user._id });
    if (!driver) {
      res.status(404).json({ message: 'Driver not found' });
      return;
    }

    const ride = await Ride.findById(rideId);
    if (!ride) {
      res.status(404).json({ message: 'Ride not found' });
      return;
    }

    if (!ride.driverId || ride.driverId.toString() !== driver._id.toString()) {
      res.status(403).json({ message: 'Not authorized to verify this ride OTP' });
      return;
    }

    if (ride.status !== 'accepted') {
      res.status(400).json({ message: 'OTP can be verified only when ride is accepted' });
      return;
    }

    if (ride.pickupOtpVerifiedAt) {
      res.json({ message: 'OTP already verified', ride: sanitizeRideForDriver(ride) });
      return;
    }

    if ((ride.pickupOtpAttempts || 0) >= 5) {
      res.status(400).json({
        message: 'Maximum OTP verification attempts (5) exceeded. Please ask passenger to cancel and rebook.',
      });
      return;
    }

    if (!ride.pickupOtp || ride.pickupOtp !== otp) {
      ride.pickupOtpAttempts = (ride.pickupOtpAttempts || 0) + 1;
      await ride.save();
      const attemptsRemaining = Math.max(0, 5 - ride.pickupOtpAttempts);
      res.status(400).json({
        message: `Invalid OTP. ${attemptsRemaining} attempt(s) remaining.`,
      });
      return;
    }

    ride.pickupOtpVerifiedAt = new Date();
    ride.pickupOtp = '';
    ride.pickupOtpAttempts = 0;
    await ride.save();

    // Notify passenger that OTP was verified
    emitRideStatusChanged(ride, 'accepted', { otpVerified: true });

    res.json({
      message: 'Passenger verified successfully',
      ride: sanitizeRideForDriver(ride),
    });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : 'Failed to verify OTP';
    res.status(500).json({ message: 'Failed to verify OTP', error: message });
  }
};

// @desc    Update ride status (in_progress or completed)
// @route   PUT /api/driver/update-ride/:rideId
// @access  Private (driver)
export const updateRideStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Not authorized' });
      return;
    }

    const { rideId } = req.params;
    const { status } = req.body as { status: RideStatus };

    if (!mongoose.isValidObjectId(rideId)) {
      res.status(400).json({ message: 'Invalid ride ID' });
      return;
    }

    const allowedTransitions: Record<string, RideStatus> = {
      accepted: 'in_progress',
      in_progress: 'completed',
    };

    const driver = await Driver.findOne({ userId: req.user._id });
    if (!driver) {
      res.status(404).json({ message: 'Driver not found' });
      return;
    }

    const ride = await Ride.findById(rideId);
    if (!ride) {
      res.status(404).json({ message: 'Ride not found' });
      return;
    }

    if (!ride.driverId || ride.driverId.toString() !== driver._id.toString()) {
      res.status(403).json({ message: 'Not authorized to update this ride' });
      return;
    }

    if (allowedTransitions[ride.status] !== status) {
      res.status(400).json({
        message: `Cannot transition from "${ride.status}" to "${status}"`,
      });
      return;
    }

    if (status === 'in_progress' && ride.pickupOtp && !ride.pickupOtpVerifiedAt) {
      res.status(400).json({ message: 'Verify passenger OTP before starting trip' });
      return;
    }

    ride.status = status;
    if (status === 'in_progress') {
      ride.startTime = new Date();
    }
    if (status === 'completed') {
      ride.endTime = new Date();
      // Atomic increment and state change to prevent race conditions
      await Driver.findByIdAndUpdate(driver._id, {
        $set: { isAvailable: true },
        $inc: { totalRides: 1, earnings: ride.fare || 0 },
      });
    }

    await ride.save();

    // Notify both rider and driver rooms of status progression
    emitRideStatusChanged(ride, status, { fare: ride.fare });

    res.json({ message: `Ride marked as ${status}`, ride: sanitizeRideForDriver(ride) });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : 'Failed to update ride status';
    res.status(500).json({ message: 'Failed to update ride status', error: message });
  }
};

// @desc    Get all rides assigned to this driver
// @route   GET /api/driver/my-rides
// @access  Private (driver)
export const getDriverRides = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Not authorized' });
      return;
    }

    await expireRequestedRides();

    const driver = await Driver.findOne({ userId: req.user._id });
    if (!driver) {
      res.status(404).json({ message: 'Driver not found' });
      return;
    }

    const rides = await Ride.find({ driverId: driver._id })
      .populate('userId', 'name phone email')
      .sort({ createdAt: -1 });

    res.json({ rides: rides.map((ride) => sanitizeRideForDriver(ride)) });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : 'Failed to fetch driver rides';
    res.status(500).json({ message: 'Failed to fetch driver rides', error: message });
  }
};
