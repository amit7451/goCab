import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import User from '../models/User';
import Driver from '../models/Driver';
import { AuthRequest } from '../types';

const generateToken = (id: Types.ObjectId): string => {
  const secret = process.env.JWT_SECRET || 'gocab_default_jwt_secret';
  const expiresIn = process.env.JWT_EXPIRES_IN || '7d';
  return jwt.sign({ id: id.toString() }, secret, {
    expiresIn,
  } as jwt.SignOptions);
};

// @desc    Register a new user or driver
// @route   POST /api/auth/register
// @access  Public
export const register = async (req: Request, res: Response): Promise<void> => {
  let createdUserId: Types.ObjectId | null = null;
  try {
    const { name, email, password, phone, role, vehicleInfo, licenseNumber } = req.body;

    if (!name || !email || !password || !phone) {
      res.status(400).json({ message: 'Name, email, password, and phone are required' });
      return;
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      res.status(400).json({ message: 'User with this email already exists' });
      return;
    }

    // Pre-validate driver fields if role is driver
    if (role === 'driver') {
      if (
        !vehicleInfo ||
        !vehicleInfo.make ||
        !vehicleInfo.model ||
        !vehicleInfo.year ||
        !vehicleInfo.licensePlate ||
        !vehicleInfo.color ||
        !licenseNumber
      ) {
        res.status(400).json({
          message: 'Complete vehicle info and license number are required for driver registration',
        });
        return;
      }

      const existingDriver = await Driver.findOne({ licenseNumber });
      if (existingDriver) {
        res.status(400).json({ message: 'Driver with this license number already exists' });
        return;
      }
    }

    // Create user
    const user = await User.create({
      name,
      email,
      password,
      phone,
      role: role || 'user',
    });
    createdUserId = user._id;

    // If registering as driver, create driver profile
    if (role === 'driver') {
      await Driver.create({
        userId: user._id,
        vehicleInfo: {
          make: vehicleInfo.make,
          model: vehicleInfo.model,
          year: Number(vehicleInfo.year),
          licensePlate: vehicleInfo.licensePlate,
          color: vehicleInfo.color,
        },
        licenseNumber,
      });
    }

    const token = generateToken(user._id);

    res.status(201).json({
      message: 'Registration successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
      },
    });
  } catch (error: any) {
    // Rollback user if driver creation or subsequent action failed
    if (createdUserId) {
      try {
        await User.findByIdAndDelete(createdUserId);
      } catch (cleanupErr) {
        console.error('Failed to rollback user creation:', cleanupErr);
      }
    }

    if (error && error.code === 11000) {
      const field = error.keyPattern ? Object.keys(error.keyPattern)[0] : 'Field';
      res.status(400).json({ message: `${field} already in use` });
      return;
    }
    const message = error instanceof Error ? error.message : 'Registration failed';
    res.status(500).json({ message: 'Registration failed', error: message });
  }
};

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ message: 'Email and password are required' });
      return;
    }

    const user = await User.findOne({ email });
    if (!user) {
      res.status(401).json({ message: 'Invalid email or password' });
      return;
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      res.status(401).json({ message: 'Invalid email or password' });
      return;
    }

    const token = generateToken(user._id);

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
      },
    });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : 'Login failed';
    res.status(500).json({ message: 'Login failed', error: message });
  }
};

// @desc    Get current logged-in user
// @route   GET /api/auth/me
// @access  Private
export const getMe = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Not authorized' });
      return;
    }
    const user = await User.findById(req.user._id).select('-password');
    res.json({ user });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : 'Failed to fetch user';
    res.status(500).json({ message: 'Failed to fetch user', error: message });
  }
};
