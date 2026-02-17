const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

const isValidLatLng = (point) =>
  isFiniteNumber(point?.lat) &&
  isFiniteNumber(point?.lng) &&
  point.lat >= -90 &&
  point.lat <= 90 &&
  point.lng >= -180 &&
  point.lng <= 180;

const toRadians = (value) => (value * Math.PI) / 180;

const haversineDistanceKm = (from, to) => {
  if (!isValidLatLng(from) || !isValidLatLng(to)) return null;

  const earthRadiusKm = 6371;
  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * earthRadiusKm * Math.asin(Math.sqrt(a));
};

const normalizePoint = (point = {}) => {
  const lat = Number(point.lat);
  const lng = Number(point.lng);

  return {
    address: String(point.address || '').trim(),
    lat: Number.isFinite(lat) ? lat : 0,
    lng: Number.isFinite(lng) ? lng : 0,
  };
};

module.exports = {
  isFiniteNumber,
  isValidLatLng,
  haversineDistanceKm,
  normalizePoint,
};
