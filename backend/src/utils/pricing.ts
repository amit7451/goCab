import { RideType } from '../types';

export interface PricingRule {
  baseFare: number;
  perKm: number;
  perMinute: number;
}

export const RIDE_PRICING_RULES: Record<RideType, PricingRule> = {
  economy: { baseFare: 35, perKm: 11, perMinute: 1.2 },
  comfort: { baseFare: 55, perKm: 16, perMinute: 1.8 },
  premium: { baseFare: 90, perKm: 24, perMinute: 2.8 },
};

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export const toPositiveNumber = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return fallback;
};

export const toNonNegativeNumber = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  return fallback;
};

export const computeTrafficMultiplier = ({
  distanceKm,
  durationMin,
}: {
  distanceKm: number;
  durationMin: number;
}): number => {
  const freeFlowSpeedKmH = 35;
  const baseDurationMin = Math.max(3, (distanceKm / freeFlowSpeedKmH) * 60);
  return Number(clamp(durationMin / baseDurationMin, 0.9, 2.2).toFixed(2));
};

export interface FareBreakdown {
  rideType: RideType;
  baseFare: number;
  distanceFare: number;
  timeFare: number;
  trafficMultiplier: number;
  trafficCharge: number;
  userPriceAddon: number;
  subtotal: number;
  total: number;
  distanceKm: number;
  durationMin: number;
}

export const getFareBreakdown = ({
  rideType,
  distanceKm,
  durationMin,
  userPriceAddon = 0,
}: {
  rideType: RideType;
  distanceKm: number;
  durationMin: number;
  userPriceAddon?: number;
}): FareBreakdown => {
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

export const getFareQuotes = ({
  distanceKm,
  durationMin,
  userPriceAddon = 0,
}: {
  distanceKm: number;
  durationMin: number;
  userPriceAddon?: number;
}): FareBreakdown[] => {
  return (Object.keys(RIDE_PRICING_RULES) as RideType[]).map((rideType) =>
    getFareBreakdown({ rideType, distanceKm, durationMin, userPriceAddon })
  );
};
