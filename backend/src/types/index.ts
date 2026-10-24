import { Request } from 'express';
import { Document, Types } from 'mongoose';

export type UserRole = 'user' | 'driver';

export interface IUser extends Document {
  _id: Types.ObjectId;
  name: string;
  email: string;
  password: string;
  phone: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
  matchPassword(enteredPassword: string): Promise<boolean>;
}

export type RideType = 'economy' | 'comfort' | 'premium';
export type PaymentMethod = 'cash' | 'card';
export type RideStatus = 'requested' | 'accepted' | 'in_progress' | 'completed' | 'cancelled';

export interface IVehicleInfo {
  make: string;
  model: string;
  year: number;
  licensePlate: string;
  color: string;
  categories?: RideType[];
}

export interface ILocation {
  address: string;
  lat: number;
  lng: number;
}

export interface ILiveLocation extends ILocation {
  updatedAt?: Date | null;
}

export interface IDriverRating {
  average: number;
  count: number;
}

export interface IDriver extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId | IUser;
  vehicleInfo: IVehicleInfo;
  licenseNumber: string;
  isAvailable: boolean;
  currentLocation: ILocation;
  rating: IDriverRating;
  totalRides: number;
  earnings: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface IFareBreakdown {
  baseFare: number;
  distanceFare: number;
  timeFare: number;
  trafficCharge: number;
  trafficMultiplier: number;
  subtotal: number;
  userPriceAddon: number;
}

export interface IRide extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId | IUser;
  driverId: Types.ObjectId | IDriver | null;
  pickup: ILocation;
  dropoff: ILocation;
  status: RideStatus;
  fare: number;
  distance: number;
  estimatedDuration: number;
  userPriceAddon: number;
  trafficMultiplier: number;
  fareBreakdown: IFareBreakdown;
  requestExpiresAt: Date | null;
  acceptedAt: Date | null;
  cancelledAt: Date | null;
  cancelledReason: string;
  userLiveLocation: ILiveLocation;
  pickupOtp?: string;
  pickupOtpGeneratedAt?: Date | null;
  pickupOtpVerifiedAt?: Date | null;
  pickupOtpAttempts?: number;
  rideType: RideType;
  paymentMethod: PaymentMethod;
  rating: number | null;
  startTime: Date | null;
  endTime: Date | null;
  createdAt: Date;
  updatedAt: Date;
  calculateFare(): number;
}

export interface AuthRequest extends Request {
  user?: IUser;
}
