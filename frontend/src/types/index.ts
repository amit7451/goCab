export type UserRole = 'user' | 'driver';

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: UserRole;
}

export type RideType = 'economy' | 'comfort' | 'premium';
export type PaymentMethod = 'cash' | 'card';
export type RideStatus = 'requested' | 'accepted' | 'in_progress' | 'completed' | 'cancelled';

export interface VehicleInfo {
  make: string;
  model: string;
  year: number;
  licensePlate: string;
  color: string;
  categories?: RideType[];
}

export interface Location {
  address: string;
  lat?: number;
  lng?: number;
}

export interface LiveLocation extends Location {
  updatedAt?: string | null;
}

export interface DriverRating {
  average: number;
  count: number;
}

export interface DriverProfile {
  _id: string;
  userId: User | string;
  vehicleInfo: VehicleInfo;
  licenseNumber: string;
  isAvailable: boolean;
  currentLocation: Location;
  rating: DriverRating;
  totalRides: number;
  earnings: number;
  createdAt: string;
  updatedAt: string;
}

export interface FareBreakdown {
  rideType: RideType;
  baseFare: number;
  distanceFare: number;
  timeFare: number;
  trafficMultiplier: number;
  trafficCharge: number;
  userPriceAddon: number;
  subtotal: number;
  total: number;
  distanceKm: number;
  durationMin: number;
}

export interface RideDriverInfo {
  _id?: string;
  vehicleInfo?: VehicleInfo;
  rating?: DriverRating;
  currentLocation?: Location;
  userId?: {
    _id?: string;
    name: string;
    phone: string;
    email?: string;
  };
}

export interface RideUserInfo {
  _id?: string;
  name: string;
  phone: string;
  email?: string;
}

export interface Ride {
  _id: string;
  userId: RideUserInfo | string;
  driverId: RideDriverInfo | null;
  pickup: Location;
  dropoff: Location;
  status: RideStatus;
  fare: number;
  distance: number;
  estimatedDuration?: number;
  userPriceAddon?: number;
  trafficMultiplier?: number;
  fareBreakdown?: Partial<FareBreakdown>;
  requestExpiresAt?: string | null;
  acceptedAt?: string | null;
  cancelledAt?: string | null;
  cancelledReason?: string;
  userLiveLocation?: LiveLocation;
  pickupOtp?: string;
  pickupOtpVerifiedAt?: string | null;
  secondsLeft?: number;
  dispatchRadiusKm?: number;
  pickupDistanceKm?: number | null;
  inRange?: boolean;
  rideType: RideType;
  paymentMethod: PaymentMethod;
  rating: number | null;
  startTime?: string | null;
  endTime?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  isAuthenticated: boolean;
  isDriver: boolean;
  isUser: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (formData: Record<string, any>) => Promise<User>;
  logout: () => void;
  updateUser: (updatedUser: User) => void;
}
