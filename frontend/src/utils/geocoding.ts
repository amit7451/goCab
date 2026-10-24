import { Location } from '../types';

const INDIAN_CITY_COORDINATES: Record<string, { lat: number; lng: number }> = {
  delhi: { lat: 28.6139, lng: 77.209 },
  'new delhi': { lat: 28.6139, lng: 77.209 },
  noida: { lat: 28.5355, lng: 77.391 },
  gurgaon: { lat: 28.4595, lng: 77.0266 },
  gurugram: { lat: 28.4595, lng: 77.0266 },
  mumbai: { lat: 19.076, lng: 72.8777 },
  pune: { lat: 18.5204, lng: 73.8567 },
  bangalore: { lat: 12.9716, lng: 77.5946 },
  bengaluru: { lat: 12.9716, lng: 77.5946 },
  hyderabad: { lat: 17.385, lng: 78.4867 },
  chennai: { lat: 13.0827, lng: 80.2707 },
  kolkata: { lat: 22.5726, lng: 88.3639 },
  ahmedabad: { lat: 23.0225, lng: 72.5714 },
  jaipur: { lat: 26.9124, lng: 75.7873 },
  lucknow: { lat: 26.8467, lng: 80.9462 },
  chandigarh: { lat: 30.7333, lng: 76.7794 },
};

export const resolveAddressCoordinates = async (
  address: string,
  googleGeocoder?: any
): Promise<Location> => {
  const cleanAddress = address.trim();
  if (!cleanAddress) {
    return { address: '', lat: 28.6139, lng: 77.209 };
  }

  // 1. Try Google Maps Geocoder if loaded and available
  if (googleGeocoder) {
    try {
      const googleResult = await new Promise<any>((resolve) => {
        googleGeocoder.geocode(
          { address: cleanAddress, componentRestrictions: { country: 'in' } },
          (results: any, status: string) => {
            if (status === 'OK' && results?.[0]?.geometry?.location) {
              resolve(results[0]);
            } else {
              resolve(null);
            }
          }
        );
      });

      if (googleResult) {
        return {
          address: googleResult.formatted_address || cleanAddress,
          lat: googleResult.geometry.location.lat(),
          lng: googleResult.geometry.location.lng(),
        };
      }
    } catch (err) {
      console.warn('Google geocoder lookup failed, using fallback:', err);
    }
  }

  // 2. Free OpenStreetMap Nominatim Geocoder (no API key needed, reliable worldwide)
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
        cleanAddress
      )}&countrycodes=in&limit=1`,
      { headers: { 'Accept-Language': 'en' } }
    );
    const data = await response.json();
    if (Array.isArray(data) && data[0]?.lat && data[0]?.lon) {
      return {
        address: data[0].display_name || cleanAddress,
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon),
      };
    }
  } catch (err) {
    console.warn('Nominatim geocoder error:', err);
  }

  // 3. Fallback based on city name match
  const lower = cleanAddress.toLowerCase();
  for (const [city, coords] of Object.entries(INDIAN_CITY_COORDINATES)) {
    if (lower.includes(city)) {
      return {
        address: cleanAddress,
        lat: coords.lat,
        lng: coords.lng,
      };
    }
  }

  // 4. Default to Connaught Place, New Delhi coordinates
  return {
    address: cleanAddress,
    lat: 28.6139,
    lng: 77.209,
  };
};

export const reverseGeocodeCoordinates = async (
  coords: { lat: number; lng: number },
  googleGeocoder?: any
): Promise<string> => {
  if (googleGeocoder) {
    try {
      const result = await new Promise<string>((resolve) => {
        googleGeocoder.geocode({ location: coords }, (results: any, status: string) => {
          if (status === 'OK' && results?.[0]?.formatted_address) {
            resolve(results[0].formatted_address);
          } else {
            resolve('');
          }
        });
      });
      if (result) return result;
    } catch {
      // Fallback
    }
  }

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${coords.lat}&lon=${coords.lng}`,
      { headers: { 'Accept-Language': 'en' } }
    );
    const data = await res.json();
    if (data?.display_name) {
      return data.display_name;
    }
  } catch {
    // Fallback
  }

  return `Location (${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)})`;
};
