const SCRIPT_ID = 'gocab-google-maps-script';
const GOOGLE_MAPS_BASE_URL = 'https://maps.googleapis.com/maps/api/js';

let mapsApiKeyPromise = null;
let googleMapsPromise = null;

const getEnvMapsApiKey = () => String(import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '').trim();

const getBackendMapsApiKey = async () => {
  const response = await fetch('/api/maps/config');
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.message || 'Failed to load Google Maps config from backend');
  }

  const key = String(data?.mapsApiKey || '').trim();
  if (!key) {
    throw new Error('Google Maps API key is empty');
  }

  return key;
};

const resolveMapsApiKey = async () => {
  if (!mapsApiKeyPromise) {
    mapsApiKeyPromise = (async () => {
      const envKey = getEnvMapsApiKey();
      if (envKey) return envKey;
      return getBackendMapsApiKey();
    })().catch((error) => {
      mapsApiKeyPromise = null;
      throw error;
    });
  }

  return mapsApiKeyPromise;
};

const loadScript = async (apiKey) =>
  new Promise((resolve, reject) => {
    if (window.google?.maps?.places) {
      resolve(window.google.maps);
      return;
    }

    const existingScript = document.getElementById(SCRIPT_ID);
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(window.google.maps), { once: true });
      existingScript.addEventListener('error', () => reject(new Error('Failed to load Google Maps script')), {
        once: true,
      });
      return;
    }

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = `${GOOGLE_MAPS_BASE_URL}?key=${encodeURIComponent(
      apiKey
    )}&libraries=places,geometry&v=weekly`;
    script.async = true;
    script.defer = true;

    script.onload = () => {
      if (!window.google?.maps?.places) {
        reject(new Error('Google Maps loaded without Places library'));
        return;
      }
      resolve(window.google.maps);
    };
    script.onerror = () => reject(new Error('Failed to load Google Maps script'));

    document.head.appendChild(script);
  });

export const loadGoogleMapsApi = async () => {
  if (window.google?.maps?.places) {
    return window.google.maps;
  }

  if (!googleMapsPromise) {
    googleMapsPromise = (async () => {
      const apiKey = await resolveMapsApiKey();
      return loadScript(apiKey);
    })().catch((error) => {
      googleMapsPromise = null;
      throw error;
    });
  }

  return googleMapsPromise;
};
