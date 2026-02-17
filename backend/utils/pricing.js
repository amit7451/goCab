const RIDE_PRICING_RULES = {
  economy: { baseFare: 35, perKm: 11, perMinute: 1.2 },
  comfort: { baseFare: 55, perKm: 16, perMinute: 1.8 },
  premium: { baseFare: 90, perKm: 24, perMinute: 2.8 },
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const toPositiveNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return fallback;
};

const toNonNegativeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  return fallback;
};

const computeTrafficMultiplier = ({ distanceKm, durationMin }) => {
  const freeFlowSpeedKmH = 35;
  const baseDurationMin = Math.max(3, (distanceKm / freeFlowSpeedKmH) * 60);
  return Number(clamp(durationMin / baseDurationMin, 0.9, 2.2).toFixed(2));
};

const getFareBreakdown = ({
  rideType,
  distanceKm,
  durationMin,
  userPriceAddon = 0,
}) => {
  const normalizedDistanceKm = Number(toPositiveNumber(distanceKm, 1).toFixed(2));
  const normalizedDurationMin = Math.round(toPositiveNumber(durationMin, 5));
  const normalizedAddon = Number(toNonNegativeNumber(userPriceAddon, 0).toFixed(0));

  const pricingRule = RIDE_PRICING_RULES[rideType] || RIDE_PRICING_RULES.economy;
  const trafficMultiplier = computeTrafficMultiplier({
    distanceKm: normalizedDistanceKm,
    durationMin: normalizedDurationMin,
  });

  const base = pricingRule.baseFare;
  const distanceFare = normalizedDistanceKm * pricingRule.perKm;
  const timeFare = normalizedDurationMin * pricingRule.perMinute;
  const subtotal = base + distanceFare + timeFare;
  const trafficCharge = subtotal * (trafficMultiplier - 1);
  const total = Math.max(0, Math.round(subtotal + trafficCharge + normalizedAddon));

  return {
    rideType,
    baseFare: Number(base.toFixed(2)),
    distanceFare: Number(distanceFare.toFixed(2)),
    timeFare: Number(timeFare.toFixed(2)),
    trafficMultiplier,
    trafficCharge: Number(trafficCharge.toFixed(2)),
    userPriceAddon: normalizedAddon,
    subtotal: Number(subtotal.toFixed(2)),
    total,
    distanceKm: normalizedDistanceKm,
    durationMin: normalizedDurationMin,
  };
};

const getFareQuotes = ({ distanceKm, durationMin, userPriceAddon = 0 }) => {
  return Object.keys(RIDE_PRICING_RULES).map((rideType) =>
    getFareBreakdown({ rideType, distanceKm, durationMin, userPriceAddon })
  );
};

module.exports = {
  RIDE_PRICING_RULES,
  getFareBreakdown,
  getFareQuotes,
  toPositiveNumber,
  toNonNegativeNumber,
};
