import Ride from '../models/Ride';

export const REQUEST_TIMEOUT_MINUTES = 5;

export const getRequestExpiryDate = (fromDate = new Date()): Date =>
  new Date(fromDate.getTime() + REQUEST_TIMEOUT_MINUTES * 60 * 1000);

export const expireRequestedRides = async (): Promise<number> => {
  const now = new Date();
  const result = await Ride.updateMany(
    {
      status: 'requested',
      driverId: null,
      requestExpiresAt: { $lte: now },
    },
    {
      $set: {
        status: 'cancelled',
        cancelledReason: 'No driver accepted within 5 minutes',
        cancelledAt: now,
      },
    }
  );

  return result.modifiedCount || 0;
};
