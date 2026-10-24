import { Response } from 'express';
import mongoose from 'mongoose';
import Ride from '../models/Ride';
import Driver from '../models/Driver';
import { AuthRequest, RideType, PaymentMethod, ILocation, IRide } from '../types';
import { getFareQuotes, toPositiveNumber, toNonNegativeNumber } from '../utils/pricing';
import { haversineDistanceKm, normalizePoint, isValidLatLng } from '../utils/geo';
import { getRequestExpiryDate, expireRequestedRides } from '../services/rideLifecycleService';

const randomDistanceKm = (): number => {
  const minKm = 2;
  const maxKm = 22;
  return Math.floor(Math.random() * (maxKm - minKm + 1)) + minKm;
};

const normalizeDistanceKm = ({
  distance,
  pickup,
  dropoff,
}: {
  distance?: number;
  pickup: ILocation;
  dropoff: ILocation;
}): number => {
  const parsedDistance = Number(distance);
  if (Number.isFinite(parsedDistance) && parsedDistance > 0) {
    return Number(parsedDistance.toFixed(2));
  }

  const haversine = haversineDistanceKm(pickup, dropoff);
  if (Number.isFinite(haversine) && haversine! > 0) {
    return Number(haversine!.toFixed(2));
  }

  return randomDistanceKm();
};

const normalizeDurationMinutes = ({
  estimatedDuration,
  distanceKm,
}: {
  estimatedDuration?: number;
  distanceKm: number;
}): number => {
  const parsedDuration = Number(estimatedDuration);
  if (Number.isFinite(parsedDuration) && parsedDuration > 0) {
    return Math.round(parsedDuration);
  }

  return Math.max(5, Math.round(distanceKm * 3));
};

const canMutateRequestedRide = (ride: IRide): boolean =>
  ride.status === 'requested' &&
  !ride.driverId &&
  !!ride.requestExpiresAt &&
  ride.requestExpiresAt.getTime() > Date.now();

export const sanitizeRideForDriver = (rideDocOrObject: any): any => {
  if (!rideDocOrObject) return rideDocOrObject;
  const ride =
    typeof rideDocOrObject.toObject === 'function'
      ? rideDocOrObject.toObject()
      : { ...rideDocOrObject };
  delete ride.pickupOtp;
  return ride;
};

// @desc    Get dynamic fare quotes
// @route   POST /api/rides/quote
// @access  Private (user)
export const getFareQuote = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const distanceKm = toPositiveNumber(req.body?.distance, 0);
    const durationMin = toPositiveNumber(req.body?.estimatedDuration, 0);
    const userPriceAddon = toNonNegativeNumber(req.body?.userPriceAddon, 0);

    if (!distanceKm || !durationMin) {
      res.status(400).json({ message: 'Distance and estimated duration are required' });
      return;
    }

    const quotes = getFareQuotes({ distanceKm, durationMin, userPriceAddon });
    res.json({ quotes });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : 'Failed to generate fare quote';
    res.status(500).json({ message: 'Failed to generate fare quote', error: message });
  }
};

// @desc    Book a new ride
// @route   POST /api/rides/book
// @access  Private (user)
export const bookRide = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Not authorized' });
      return;
    }

    const {
      pickup,
      dropoff,
      rideType,
      paymentMethod,
      distance,
      estimatedDuration,
      userPriceAddon,
    } = req.body as {
      pickup?: Partial<ILocation>;
      dropoff?: Partial<ILocation>;
      rideType?: RideType;
      paymentMethod?: PaymentMethod;
      distance?: number;
      estimatedDuration?: number;
      userPriceAddon?: number;
    };

    const pickupPoint = normalizePoint(pickup);
    const dropoffPoint = normalizePoint(dropoff);

    if (!pickupPoint.address || !dropoffPoint.address) {
      res.status(400).json({ message: 'Pickup and dropoff addresses are required' });
      return;
    }

    if (pickupPoint.address.toLowerCase() === dropoffPoint.address.toLowerCase()) {
      res.status(400).json({ message: 'Pickup and dropoff cannot be the same' });
      return;
    }

    await expireRequestedRides();

    const existingActiveRide = await Ride.findOne({
      userId: req.user._id,
      status: { $in: ['requested', 'accepted', 'in_progress'] },
    }).sort({ createdAt: -1 });

    if (existingActiveRide) {
      res.status(400).json({
        message: 'You already have an active ride. Complete or cancel it before booking another.',
        rideId: existingActiveRide._id,
      });
      return;
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

    res.status(201).json({
      message: 'Ride booked successfully',
      ride,
    });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : 'Failed to book ride';
    res.status(500).json({ message: 'Failed to book ride', error: message });
  }
};

// @desc    Update user fare add-on while waiting
// @route   PUT /api/rides/:id/addon
// @access  Private (user)
export const updateRideAddon = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Not authorized' });
      return;
    }

    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      res.status(400).json({ message: 'Invalid ride ID' });
      return;
    }

    await expireRequestedRides();

    const ride = await Ride.findById(id);
    if (!ride) {
      res.status(404).json({ message: 'Ride not found' });
      return;
    }

    const rideUserId = (ride.userId as any)?._id || ride.userId;
    if (rideUserId.toString() !== req.user._id.toString()) {
      res.status(403).json({ message: 'Not authorized' });
      return;
    }

    if (!canMutateRequestedRide(ride)) {
      res.status(400).json({ message: 'Can update price only during active 5-minute wait window' });
      return;
    }

    const absoluteAddon = toNonNegativeNumber(req.body?.userPriceAddon, NaN);
    const incrementBy = toNonNegativeNumber(req.body?.incrementBy, NaN);

    if (Number.isFinite(absoluteAddon)) {
      ride.userPriceAddon = absoluteAddon;
    } else if (Number.isFinite(incrementBy) && incrementBy > 0) {
      ride.userPriceAddon = Number(ride.userPriceAddon || 0) + incrementBy;
    } else {
      res.status(400).json({ message: 'Provide userPriceAddon or incrementBy' });
      return;
    }

    ride.calculateFare();
    await ride.save();

    res.json({
      message: 'Ride price updated successfully',
      ride,
    });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : 'Failed to update ride price';
    res.status(500).json({ message: 'Failed to update ride price', error: message });
  }
};

// @desc    Update user live location for active ride
// @route   PUT /api/rides/:id/user-location
// @access  Private (user)
export const updateUserLiveLocation = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Not authorized' });
      return;
    }

    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      res.status(400).json({ message: 'Invalid ride ID' });
      return;
    }

    const ride = await Ride.findById(id);
    if (!ride) {
      res.status(404).json({ message: 'Ride not found' });
      return;
    }

    const rideUserId = (ride.userId as any)?._id || ride.userId;
    if (rideUserId.toString() !== req.user._id.toString()) {
      res.status(403).json({ message: 'Not authorized' });
      return;
    }

    if (!['requested', 'accepted', 'in_progress'].includes(ride.status)) {
      res.status(400).json({ message: `Cannot update location when ride is ${ride.status}` });
      return;
    }

    const lat = Number(req.body?.lat);
    const lng = Number(req.body?.lng);
    const address = String(req.body?.address || '').trim();

    if (!isValidLatLng({ lat, lng })) {
      res.status(400).json({ message: 'Valid lat/lng are required' });
      return;
    }

    ride.userLiveLocation = {
      address,
      lat,
      lng,
      updatedAt: new Date(),
    };
    await ride.save();

    res.json({ message: 'User location updated', ride });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : 'Failed to update location';
    res.status(500).json({ message: 'Failed to update location', error: message });
  }
};

// @desc    Get all rides for logged-in user
// @route   GET /api/rides/my-rides
// @access  Private (user)
export const getMyRides = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Not authorized' });
      return;
    }

    await expireRequestedRides();

    const rides = await Ride.find({ userId: req.user._id })
      .populate({
        path: 'driverId',
        select: 'vehicleInfo rating userId currentLocation',
        populate: { path: 'userId', select: 'name phone' },
      })
      .sort({ createdAt: -1 });

    res.json({ rides });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : 'Failed to fetch rides';
    res.status(500).json({ message: 'Failed to fetch rides', error: message });
  }
};

// @desc    Get a single ride by ID
// @route   GET /api/rides/:id
// @access  Private
export const getRideById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Not authorized' });
      return;
    }

    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      res.status(400).json({ message: 'Invalid ride ID' });
      return;
    }

    await expireRequestedRides();

    const ride = await Ride.findById(id)
      .populate('userId', 'name phone email')
      .populate({
        path: 'driverId',
        select: 'vehicleInfo rating userId currentLocation',
        populate: { path: 'userId', select: 'name phone' },
      });

    if (!ride) {
      res.status(404).json({ message: 'Ride not found' });
      return;
    }

    const rideUserId = (ride.userId as any)?._id || ride.userId;
    const isOwner = rideUserId.toString() === req.user._id.toString();
    const isDriver = req.user.role === 'driver';
    if (!isOwner && !isDriver) {
      res.status(403).json({ message: 'Not authorized to view this ride' });
      return;
    }

    if (isDriver) {
      res.json({ ride: sanitizeRideForDriver(ride) });
      return;
    }

    res.json({ ride });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : 'Failed to fetch ride';
    res.status(500).json({ message: 'Failed to fetch ride', error: message });
  }
};

// @desc    Cancel a ride (by user)
// @route   PUT /api/rides/:id/cancel
// @access  Private (user)
export const cancelRide = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Not authorized' });
      return;
    }

    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      res.status(400).json({ message: 'Invalid ride ID' });
      return;
    }

    const ride = await Ride.findById(id);

    if (!ride) {
      res.status(404).json({ message: 'Ride not found' });
      return;
    }

    const rideUserId = (ride.userId as any)?._id || ride.userId;
    if (rideUserId.toString() !== req.user._id.toString()) {
      res.status(403).json({ message: 'Not authorized to cancel this ride' });
      return;
    }

    if (['completed', 'cancelled', 'in_progress'].includes(ride.status)) {
      res.status(400).json({ message: `Cannot cancel a ride that is ${ride.status}` });
      return;
    }

    const previousDriverId = ride.driverId;
    ride.status = 'cancelled';
    ride.cancelledAt = new Date();
    ride.cancelledReason = 'Cancelled by user';
    await ride.save();

    // Release driver availability if accepted
    if (previousDriverId) {
      try {
        await Driver.findByIdAndUpdate(previousDriverId, { isAvailable: true });
      } catch (driverErr) {
        console.error('Failed to restore driver availability on cancel:', driverErr);
      }
    }

    res.json({ message: 'Ride cancelled successfully', ride });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : 'Failed to cancel ride';
    res.status(500).json({ message: 'Failed to cancel ride', error: message });
  }
};

// @desc    Rate a completed ride
// @route   PUT /api/rides/:id/rate
// @access  Private (user)
export const rateRide = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Not authorized' });
      return;
    }

    const { id } = req.params;
    const { rating } = req.body;

    const numericRating = Number(rating);
    if (!numericRating || !Number.isInteger(numericRating) || numericRating < 1 || numericRating > 5) {
      res.status(400).json({ message: 'Rating must be an integer between 1 and 5' });
      return;
    }

    if (!mongoose.isValidObjectId(id)) {
      res.status(400).json({ message: 'Invalid ride ID' });
      return;
    }

    const ride = await Ride.findById(id);

    if (!ride) {
      res.status(404).json({ message: 'Ride not found' });
      return;
    }

    const rideUserId = (ride.userId as any)?._id || ride.userId;
    if (rideUserId.toString() !== req.user._id.toString()) {
      res.status(403).json({ message: 'Not authorized' });
      return;
    }

    if (ride.status !== 'completed') {
      res.status(400).json({ message: 'Can only rate completed rides' });
      return;
    }

    if (ride.rating) {
      res.status(400).json({ message: 'Ride already rated' });
      return;
    }

    ride.rating = numericRating;
    await ride.save();

    // Update driver rating
    if (ride.driverId) {
      const driver = await Driver.findById(ride.driverId);
      if (driver) {
        const currentCount = driver.rating?.count || 0;
        const currentAvg = driver.rating?.average || 0;
        const newCount = currentCount + 1;
        const newAvg = (currentAvg * currentCount + numericRating) / newCount;
        driver.rating = { average: parseFloat(newAvg.toFixed(1)), count: newCount };
        await driver.save();
      }
    }

    res.json({ message: 'Ride rated successfully', ride });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : 'Failed to rate ride';
    res.status(500).json({ message: 'Failed to rate ride', error: message });
  }
};
