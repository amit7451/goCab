import Ride from '../models/Ride';
import { getIO } from './socketService';

export const REQUEST_TIMEOUT_MINUTES = 5;

export const getRequestExpiryDate = (fromDate = new Date()): Date =>
  new Date(fromDate.getTime() + REQUEST_TIMEOUT_MINUTES * 60 * 1000);

export const expireRequestedRides = async (): Promise<number> => {
  const now = new Date();
  const expiredRides = await Ride.find({
    status: 'requested',
    driverId: null,
    requestExpiresAt: { $lte: now },
  });

  if (expiredRides.length === 0) return 0;

  const result = await Ride.updateMany(
    {
      _id: { $in: expiredRides.map((r) => r._id) },
      status: 'requested',
    },
    {
      $set: {
        status: 'cancelled',
        cancelledReason: 'No driver accepted within 5 minutes',
        cancelledAt: now,
      },
    }
  );

  const io = getIO();
  if (io) {
    expiredRides.forEach((ride) => {
      const payload = {
        rideId: ride._id.toString(),
        status: 'cancelled',
        cancelledAt: now,
        cancelledReason: 'No driver accepted within 5 minutes',
      };
      io.to(`ride:${ride._id.toString()}`).emit('ride:cancelled', payload);
      io.to(`user:${ride.userId.toString()}`).emit('ride:cancelled', payload);
      io.to('drivers').emit('ride:cancelled', payload);
    });
  }

  return result.modifiedCount || 0;
};
