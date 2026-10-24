import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export const getSocket = (): Socket | null => socket;

export const connectSocket = (token?: string): Socket => {
  const authToken = token || localStorage.getItem('gocab_token') || '';

  if (socket && socket.connected) {
    return socket;
  }

  // Determine socket server URL
  const serverUrl =
    import.meta.env.VITE_BACKEND_URL ||
    (window.location.hostname === 'localhost' ? 'http://localhost:5000' : window.location.origin);

  socket = io(serverUrl, {
    auth: {
      token: authToken,
    },
    transports: ['websocket', 'polling'],
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
  });

  return socket;
};

export const disconnectSocket = (): void => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};

export const joinRideRoom = (rideId: string): void => {
  if (socket && rideId) {
    socket.emit('join_ride_room', { rideId });
  }
};

export const leaveRideRoom = (rideId: string): void => {
  if (socket && rideId) {
    socket.emit('leave_ride_room', { rideId });
  }
};

export const sendDriverLocation = (
  rideId: string | undefined,
  coords: { lat: number; lng: number; address?: string }
): void => {
  if (socket && socket.connected) {
    socket.emit('driver:location_update', {
      rideId,
      lat: coords.lat,
      lng: coords.lng,
      address: coords.address,
    });
  }
};

export const sendUserLocation = (
  rideId: string,
  coords: { lat: number; lng: number; address?: string }
): void => {
  if (socket && socket.connected) {
    socket.emit('user:location_update', {
      rideId,
      lat: coords.lat,
      lng: coords.lng,
      address: coords.address,
    });
  }
};
