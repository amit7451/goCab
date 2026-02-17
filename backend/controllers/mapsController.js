const getConfiguredMapsApiKey = () =>
  process.env.GOOGLE_MAPS_API_KEY ||
  process.env.GOOGLE_MAP_API_KEY ||
  process.env['GOOGLE_MAP_API KEY'] ||
  '';

// @desc    Return Google Maps runtime config for frontend
// @route   GET /api/maps/config
// @access  Public
const getMapsConfig = (req, res) => {
  const mapsApiKey = getConfiguredMapsApiKey().trim();

  if (!mapsApiKey) {
    return res.status(500).json({
      message: 'Google Maps API key is missing. Set GOOGLE_MAPS_API_KEY in backend/.env',
    });
  }

  return res.json({ mapsApiKey });
};

module.exports = { getMapsConfig };
