import http from 'http';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import connectDB from './config/db';
import authRoutes from './routes/authRoutes';
import rideRoutes from './routes/rideRoutes';
import driverRoutes from './routes/driverRoutes';
import mapsRoutes from './routes/mapsRoutes';
import { expireRequestedRides } from './services/rideLifecycleService';
import { initSocketServer } from './services/socketService';

dotenv.config();
connectDB();

const app = express();
const httpServer = http.createServer(app);

// Initialize real-time Socket.IO server with JWT authentication
initSocketServer(httpServer);

app.use(
  cors({
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    credentials: true,
  })
);
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/rides', rideRoutes);
app.use('/api/driver', driverRoutes);
app.use('/api/maps', mapsRoutes);

// Health check
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'GoCab API is running' });
});

// Global error handler
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err.stack || err);
  const message = err?.message || 'Internal server error';
  res.status(500).json({ message, error: message });
});

const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  console.log(`🚕 GoCab server running on port ${PORT}`);
});

// Keep ride timers consistent for all clients
setInterval(() => {
  expireRequestedRides().catch(() => {});
}, 15000);

export { app, httpServer };
export default app;
