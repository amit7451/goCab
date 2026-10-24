import { Location } from '../types';

/**
 * Geocode an address using real Google Maps Geocoder.
 * Returns real coordinates or null if address is not found.
 */
export const geocodeAddress = (
  address: string,
  geocoder?: any
): Promise<Location | null> => {
  const text = address.trim();
  if (!text) return Promise.resolve(null);

  const g =
    geocoder ||
    ((window as any).google?.maps?.Geocoder
      ? new (window as any).google.maps.Geocoder()
      : null);

  if (!g) return Promise.resolve(null);

  return new Promise((resolve) => {
    g.geocode({ address: text }, (results: any, status: string) => {
      if (status === 'OK' && results?.[0]?.geometry?.location) {
        resolve({
          address: results[0].formatted_address || text,
          lat: results[0].geometry.location.lat(),
          lng: results[0].geometry.location.lng(),
        });
      } else {
        resolve(null);
      }
    });
  });
};

/**
 * Reverse geocode coordinates to a real address string using Google Maps Geocoder.
 */
export const reverseGeocodeCoords = (
  coords: { lat: number; lng: number },
  geocoder?: any
): Promise<string> => {
  const g =
    geocoder ||
    ((window as any).google?.maps?.Geocoder
      ? new (window as any).google.maps.Geocoder()
      : null);

  if (!g) return Promise.resolve('');

  return new Promise((resolve) => {
    g.geocode({ location: coords }, (results: any, status: string) => {
      if (status === 'OK' && results?.[0]?.formatted_address) {
        resolve(results[0].formatted_address);
      } else {
        resolve('');
      }
    });
  });
};
