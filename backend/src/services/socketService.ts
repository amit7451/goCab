import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import User from '../models/User';
import Driver from '../models/Driver';
import Ride from '../models/Ride';
import { IUser, IDriver, IRide } from '../types';
import { isValidLatLng } from '../utils/geo';
import { sanitizeRideForDriver } from '../controllers/rideController';

interface SocketData {
  user: IUser;
  driver?: IDriver | null;
}

let io: Server | null = null;

export const initSocketServer = (httpServer: HttpServer): Server => {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.CLIENT_URL || 'http://localhost:5173',
      credentials: true,
      methods: ['GET', 'POST'],
    },
    pingTimeout: 30000,
    pingInterval: 10000,
  });

  // JWT Handshake Authentication Middleware
  io.use(async (socket: Socket, next) => {
    try {
      const authHeader = socket.handshake.headers?.authorization;
      const token =
        socket.handshake.auth?.token ||
        (authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null);

      if (!token) {
        return next(new Error('Authentication failed: Token required'));
      }

      const secret = process.env.JWT_SECRET || 'gocab_default_jwt_secret';
      const decoded = jwt.verify(token, secret) as { id: string };

      const user = await User.findById(decoded.id).select('-password');
      if (!user) {
        return next(new Error('Authentication failed: User not found'));
      }

      const socketData: SocketData = { user };

      if (user.role === 'driver') {
        const driver = await Driver.findOne({ userId: user._id });
        socketData.driver = driver;
      }

      (socket as any).data = socketData;
      next();
    } catch (error) {
      next(new Error('Authentication failed: Invalid or expired token'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const data = (socket as any).data as SocketData;
    const user = data.user;
    const driver = data.driver;

    // Join personal user room for direct user alerts
    socket.join(`user:${user._id.toString()}`);

    // If driver, join drivers channel and direct driver room
    if (user.role === 'driver' && driver) {
      socket.join('drivers');
      socket.join(`driver:${driver._id.toString()}`);
    }

    // Join ride-specific room with strict authorization
    socket.on('join_ride_room', async ({ rideId }: { rideId: string }) => {
      try {
        if (!mongoose.isValidObjectId(rideId)) return;

        const ride = await Ride.findById(rideId);
        if (!ride) return;

        const rideUserId = (ride.userId as any)?._id || ride.userId;
        const isPassenger = rideUserId && rideUserId.toString() === user._id.toString();

        let currentDriver = driver;
        if (!currentDriver && user.role === 'driver') {
          currentDriver = await Driver.findOne({ userId: user._id });
        }

        const rideDriverId = (ride.driverId as any)?._id || ride.driverId;
        const isAssignedDriver =
          currentDriver && rideDriverId && rideDriverId.toString() === currentDriver._id.toString();

        // Only the passenger and assigned driver are authorized into the private ride room
        if (isPassenger || isAssignedDriver) {
          socket.join(`ride:${rideId}`);
        }
      } catch (err) {
        console.error('Error joining ride room:', err);
      }
    });

    // Leave ride-specific room
    socket.on('leave_ride_room', ({ rideId }: { rideId: string }) => {
      if (rideId) {
        socket.leave(`ride:${rideId}`);
      }
    });

    // Real-time Driver Location Broadcast
    socket.on(
      'driver:location_update',
      async (payload: {
        rideId?: string;
        lat: number;
        lng: number;
        address?: string;
      }) => {
        try {
          let currentDriver = driver;
          if (!currentDriver && user.role === 'driver') {
            currentDriver = await Driver.findOne({ userId: user._id });
          }
          if (user.role !== 'driver' || !currentDriver) return;

          const { rideId, lat, lng, address } = payload;
          if (!isValidLatLng({ lat, lng })) return;

          // Update driver's location in DB
          currentDriver.currentLocation = {
            address: address || '',
            lat,
            lng,
          };
          await currentDriver.save();

          const updateData = {
            driverId: currentDriver._id.toString(),
            lat,
            lng,
            address: address || '',
            updatedAt: new Date().toISOString(),
          };

          let targetRideId = rideId;
          let passengerUserId: string | null = null;

          if (targetRideId && mongoose.isValidObjectId(targetRideId)) {
            const ride = await Ride.findById(targetRideId).select('userId status');
            if (ride) {
              passengerUserId = ((ride.userId as any)?._id || ride.userId)?.toString() || null;
            }
          } else {
            // If rideId omitted, locate any active trip currently undertaken by this driver
            const activeRide = await Ride.findOne({
              driverId: currentDriver._id,
              status: { $in: ['accepted', 'in_progress'] },
            }).select('userId');
            if (activeRide) {
              targetRideId = activeRide._id.toString();
              passengerUserId = ((activeRide.userId as any)?._id || activeRide.userId)?.toString() || null;
            }
          }

          // Broadcast to ride room
          if (targetRideId) {
            io?.to(`ride:${targetRideId}`).emit('driver:location_changed', updateData);
          }
          // Direct broadcast to passenger personal room ensures delivery even if ride room join is in flight
          if (passengerUserId) {
            io?.to(`user:${passengerUserId}`).emit('driver:location_changed', updateData);
          }
        } catch (err) {
          console.error('Error handling driver location update:', err);
        }
      }
    );

    // Real-time Passenger Location Broadcast
    socket.on(
      'user:location_update',
      async (payload: {
        rideId: string;
        lat: number;
        lng: number;
        address?: string;
      }) => {
        try {
          const { rideId, lat, lng, address } = payload;
          if (!rideId || !mongoose.isValidObjectId(rideId)) return;
          if (!isValidLatLng({ lat, lng })) return;

          const ride = await Ride.findById(rideId);
          if (!ride) return;

          const rideUserId = (ride.userId as any)?._id || ride.userId;
          if (rideUserId.toString() !== user._id.toString()) return;

          ride.userLiveLocation = {
            address: address || '',
            lat,
            lng,
            updatedAt: new Date(),
          };
          await ride.save();

          const updateData = {
            rideId,
            lat,
            lng,
            address: address || '',
            updatedAt: new Date().toISOString(),
          };

          io?.to(`ride:${rideId}`).emit('user:location_changed', updateData);
        } catch (err) {
          console.error('Error handling user location update:', err);
        }
      }
    );

    socket.on('disconnect', () => {
      // Disconnected cleanly
    });
  });

  return io;
};

export const getIO = (): Server | null => io;

// Real-time Event Helpers for Controllers
export const emitRideRequested = (ride: IRide): void => {
  if (!io) return;
  // Broadcast to all drivers in the dispatch pool
  io.to('drivers').emit('ride:new_offer', {
    rideId: ride._id.toString(),
    rideType: ride.rideType,
    pickup: ride.pickup,
    dropoff: ride.dropoff,
    fare: ride.fare,
    requestExpiresAt: ride.requestExpiresAt,
  });
};

export const emitRideAccepted = (ride: IRide, driver: IDriver): void => {
  if (!io) return;
  const rideUserId = (ride.userId as any)?._id || ride.userId;

  const payload = {
    rideId: ride._id.toString(),
    driver: {
      _id: driver._id,
      vehicleInfo: driver.vehicleInfo,
      rating: driver.rating,
      currentLocation: driver.currentLocation,
    },
    acceptedAt: ride.acceptedAt,
  };

  // Notify passenger directly
  io.to(`user:${rideUserId.toString()}`).emit('ride:accepted', payload);
  io.to(`ride:${ride._id.toString()}`).emit('ride:accepted', payload);
};

export const emitRideStatusChanged = (
  ride: IRide,
  status: string,
  extraPayload: Record<string, any> = {}
): void => {
  if (!io) return;
  const rideUserId = (ride.userId as any)?._id || ride.userId;

  const payload = {
    rideId: ride._id.toString(),
    status,
    ...extraPayload,
    updatedAt: new Date().toISOString(),
  };

  io.to(`ride:${ride._id.toString()}`).emit('ride:status_changed', payload);
  io.to(`user:${rideUserId.toString()}`).emit('ride:status_changed', payload);

  if (ride.driverId) {
    const driverId = (ride.driverId as any)?._id || ride.driverId;
    io.to(`driver:${driverId.toString()}`).emit('ride:status_changed', payload);
  }
};

export const emitRidePriceAddonUpdated = (ride: IRide): void => {
  if (!io) return;
  io.to('drivers').emit('ride:price_boosted', {
    rideId: ride._id.toString(),
    newFare: ride.fare,
    userPriceAddon: ride.userPriceAddon,
  });
  io.to(`ride:${ride._id.toString()}`).emit('ride:price_boosted', {
    rideId: ride._id.toString(),
    newFare: ride.fare,
    userPriceAddon: ride.userPriceAddon,
  });
};

export const emitRideCancelled = (ride: IRide): void => {
  if (!io) return;
  const rideUserId = (ride.userId as any)?._id || ride.userId;
  const payload = {
    rideId: ride._id.toString(),
    status: 'cancelled',
    cancelledAt: ride.cancelledAt,
    cancelledReason: ride.cancelledReason,
  };

  io.to(`ride:${ride._id.toString()}`).emit('ride:cancelled', payload);
  io.to(`user:${rideUserId.toString()}`).emit('ride:cancelled', payload);
  io.to('drivers').emit('ride:cancelled', payload);

  if (ride.driverId) {
    const driverId = (ride.driverId as any)?._id || ride.driverId;
    io.to(`driver:${driverId.toString()}`).emit('ride:cancelled', payload);
  }
};
