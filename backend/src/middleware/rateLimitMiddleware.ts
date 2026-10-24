import rateLimit from 'express-rate-limit';

// Rate limiter for authentication attempts (login & register)
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Limit each IP to 20 auth requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: 'Too many authentication attempts from this IP, please try again after 15 minutes',
  },
});

// Rate limiter for OTP verification attempts to prevent brute force
export const otpRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10, // Limit each IP to 10 OTP attempts per 5 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: 'Too many OTP verification attempts. Please wait 5 minutes before trying again.',
  },
});
