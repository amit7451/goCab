import { Request, Response } from 'express';

const getConfiguredMapsApiKey = (): string =>
  process.env.GOOGLE_MAPS_API_KEY ||
  process.env.GOOGLE_MAP_API_KEY ||
  process.env['GOOGLE_MAP_API KEY'] ||
  '';

// @desc    Return Google Maps runtime config for frontend
// @route   GET /api/maps/config
// @access  Public
export const getMapsConfig = (_req: Request, res: Response): void => {
  const mapsApiKey = getConfiguredMapsApiKey().trim();

  if (!mapsApiKey) {
    res.status(500).json({
      message: 'Google Maps API key is missing. Set GOOGLE_MAPS_API_KEY in backend/.env',
    });
    return;
  }

  res.json({ mapsApiKey });
};
