const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Driver = require('../models/Driver');

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
};

// @desc    Register a new user or driver
// @route   POST /api/auth/register
// @access  Public
const register = async (req, res) => {
  try {
    const { name, email, password, phone, role, vehicleInfo, licenseNumber } = req.body;
    const normalizedPhone = String(phone || '').replace(/\D/g, '');
    const phoneToSave =
      normalizedPhone.length > 10 ? normalizedPhone.slice(-10) : normalizedPhone;

    if (!/^\d{10}$/.test(phoneToSave)) {
      return res.status(400).json({ message: 'Phone number must be exactly 10 digits' });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User with this email already exists' });
    }

    // Create user
    const user = await User.create({ name, email, password, phone: phoneToSave, role: role || 'user' });

    // If registering as driver, create driver profile
    if (role === 'driver') {
      if (!vehicleInfo || !licenseNumber) {
        await User.findByIdAndDelete(user._id);
        return res.status(400).json({
          message: 'Vehicle info and license number are required for driver registration',
        });
      }

      await Driver.create({
        userId: user._id,
        vehicleInfo,
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
  } catch (error) {
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(400).json({ message: `${field} already in use` });
    }
    res.status(500).json({ message: 'Registration failed', error: error.message });
  }
};

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
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
  } catch (error) {
    res.status(500).json({ message: 'Login failed', error: error.message });
  }
};

// @desc    Get current logged-in user
// @route   GET /api/auth/me
// @access  Private
const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    res.json({ user });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch user', error: error.message });
  }
};

module.exports = { register, login, getMe };
