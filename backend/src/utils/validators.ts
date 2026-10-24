import { RideType } from '../types';

export const isValidEmail = (email: unknown): boolean => {
  if (typeof email !== 'string') return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.trim());
};

export const isValidPassword = (password: unknown): boolean => {
  return typeof password === 'string' && password.trim().length >= 6;
};

export const isValidPhone = (phone: unknown): boolean => {
  if (typeof phone !== 'string') return false;
  const cleanPhone = phone.trim().replace(/[\s\-\(\)\+]/g, '');
  return cleanPhone.length >= 7 && cleanPhone.length <= 15 && /^\d+$/.test(cleanPhone);
};

export const sanitizeString = (val: unknown): string => {
  if (typeof val !== 'string') return '';
  return val.trim();
};

export const ALLOWED_CATEGORIES: RideType[] = ['economy', 'comfort', 'premium'];

export const validateVehicleCategories = (categories: unknown): RideType[] => {
  if (!Array.isArray(categories)) {
    return ['economy'];
  }
  const filtered = categories.filter((c): c is RideType =>
    ALLOWED_CATEGORIES.includes(c as RideType)
  );
  return filtered.length > 0 ? filtered : ['economy'];
};
