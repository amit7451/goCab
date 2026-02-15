const mongoose = require('mongoose');

const rideSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Driver',
      default: null,
    },
    pickup: {
      address: { type: String, required: true },
      lat: { type: Number, default: 0 },
      lng: { type: Number, default: 0 },
    },
    dropoff: {
      address: { type: String, required: true },
      lat: { type: Number, default: 0 },
      lng: { type: Number, default: 0 },
    },
    status: {
      type: String,
      enum: ['requested', 'accepted', 'in_progress', 'completed', 'cancelled'],
      default: 'requested',
    },
    fare: {
      type: Number,
      default: 0,
    },
    distance: {
      type: Number, // in km
      default: 0,
    },
    rideType: {
      type: String,
      enum: ['economy', 'comfort', 'premium'],
      default: 'economy',
    },
    paymentMethod: {
      type: String,
      enum: ['cash', 'card'],
      default: 'cash',
    },
    rating: {
      type: Number,
      min: 1,
      max: 5,
      default: null,
    },
    startTime: { type: Date, default: null },
    endTime: { type: Date, default: null },
  },
  { timestamps: true }
);

// Fare calculation helper (called before saving)
rideSchema.methods.calculateFare = function () {
  const ratePerKm = { economy: 12, comfort: 18, premium: 25 };
  const baseFare = { economy: 30, comfort: 50, premium: 80 };
  const rate = ratePerKm[this.rideType] || 12;
  const base = baseFare[this.rideType] || 30;
  this.fare = base + this.distance * rate;
  return this.fare;
};

module.exports = mongoose.model('Ride', rideSchema);
