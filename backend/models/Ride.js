const mongoose = require('mongoose');
const { getFareBreakdown } = require('../utils/pricing');

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
    estimatedDuration: {
      type: Number, // in minutes
      default: 0,
    },
    userPriceAddon: {
      type: Number,
      default: 0,
      min: 0,
    },
    trafficMultiplier: {
      type: Number,
      default: 1,
    },
    fareBreakdown: {
      baseFare: { type: Number, default: 0 },
      distanceFare: { type: Number, default: 0 },
      timeFare: { type: Number, default: 0 },
      trafficCharge: { type: Number, default: 0 },
      trafficMultiplier: { type: Number, default: 1 },
      subtotal: { type: Number, default: 0 },
      userPriceAddon: { type: Number, default: 0 },
    },
    requestExpiresAt: {
      type: Date,
      default: null,
    },
    acceptedAt: {
      type: Date,
      default: null,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    cancelledReason: {
      type: String,
      default: '',
    },
    userLiveLocation: {
      address: { type: String, default: '' },
      lat: { type: Number, default: 0 },
      lng: { type: Number, default: 0 },
      updatedAt: { type: Date, default: null },
    },
    pickupOtp: {
      type: String,
      default: '',
    },
    pickupOtpGeneratedAt: {
      type: Date,
      default: null,
    },
    pickupOtpVerifiedAt: {
      type: Date,
      default: null,
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

rideSchema.index({ status: 1, driverId: 1, requestExpiresAt: 1, rideType: 1 });

// Fare calculation helper (called before saving)
rideSchema.methods.calculateFare = function () {
  const breakdown = getFareBreakdown({
    rideType: this.rideType,
    distanceKm: this.distance,
    durationMin: this.estimatedDuration,
    userPriceAddon: this.userPriceAddon,
  });

  this.distance = breakdown.distanceKm;
  this.estimatedDuration = breakdown.durationMin;
  this.trafficMultiplier = breakdown.trafficMultiplier;
  this.fareBreakdown = {
    baseFare: breakdown.baseFare,
    distanceFare: breakdown.distanceFare,
    timeFare: breakdown.timeFare,
    trafficCharge: breakdown.trafficCharge,
    trafficMultiplier: breakdown.trafficMultiplier,
    subtotal: breakdown.subtotal,
    userPriceAddon: breakdown.userPriceAddon,
  };
  this.fare = breakdown.total;
  return this.fare;
};

module.exports = mongoose.model('Ride', rideSchema);
