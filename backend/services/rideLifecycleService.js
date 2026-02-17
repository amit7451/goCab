const Ride = require('../models/Ride');

const REQUEST_TIMEOUT_MINUTES = 5;

const getRequestExpiryDate = (fromDate = new Date()) =>
  new Date(fromDate.getTime() + REQUEST_TIMEOUT_MINUTES * 60 * 1000);

const expireRequestedRides = async () => {
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

module.exports = {
  REQUEST_TIMEOUT_MINUTES,
  getRequestExpiryDate,
  expireRequestedRides,
};
