const mongoose = require('mongoose');

const driverSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    vehicleInfo: {
      make: { type: String, required: true, trim: true },
      model: { type: String, required: true, trim: true },
      year: { type: Number, required: true },
      licensePlate: { type: String, required: true, uppercase: true, trim: true },
      color: { type: String, required: true, trim: true },
    },
    licenseNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    isAvailable: {
      type: Boolean,
      default: true,
    },
    currentLocation: {
      address: { type: String, default: '' },
      lat: { type: Number, default: 0 },
      lng: { type: Number, default: 0 },
    },
    rating: {
      average: { type: Number, default: 0 },
      count: { type: Number, default: 0 },
    },
    totalRides: {
      type: Number,
      default: 0,
    },
    earnings: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Driver', driverSchema);
