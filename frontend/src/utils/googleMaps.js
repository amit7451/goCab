import API from '../api/axios';

const SCRIPT_ID = 'gocab-google-maps-script';
const GOOGLE_MAPS_BASE_URL = 'https://maps.googleapis.com/maps/api/js';
const SCRIPT_TIMEOUT_MS = 15000;

let mapsApiKeyPromise = null;
let googleMapsPromise = null;

const getEnvMapsApiKey = () => String(import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '').trim();

const getBackendMapsApiKey = async () => {
  const candidates = [];

  candidates.push(async () => {
    const response = await API.get('/maps/config');
    return String(response?.data?.mapsApiKey || '').trim();
  });

  candidates.push(async () => {
    const response = await fetch('/api/maps/config', { credentials: 'omit' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.message || `Maps config request failed (${response.status})`);
    }
    return String(data?.mapsApiKey || '').trim();
  });

  const externalBase = String(import.meta.env.VITE_API_URL || '').trim();
  if (externalBase) {
    const normalizedBase = externalBase.replace(/\/+$/, '');
    const withApiSuffix = /\/api$/i.test(normalizedBase) ? normalizedBase : `${normalizedBase}/api`;
    candidates.push(async () => {
      const response = await fetch(`${withApiSuffix}/maps/config`, { credentials: 'omit' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.message || `Maps config request failed (${response.status})`);
      }
      return String(data?.mapsApiKey || '').trim();
    });
  }

  let lastError = null;
  for (const loadCandidate of candidates) {
    try {
      const key = await loadCandidate();
      if (key) return key;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Google Maps API key is empty');
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

const isMapsLoaded = (requirePlaces = false) =>
  requirePlaces ? !!window.google?.maps?.places : !!window.google?.maps;

const waitForMapsReady = (requirePlaces = false, timeoutMs = SCRIPT_TIMEOUT_MS) =>
  new Promise((resolve, reject) => {
    if (isMapsLoaded(requirePlaces)) {
      resolve(window.google.maps);
      return;
    }

    const startedAt = Date.now();
    const poll = () => {
      if (isMapsLoaded(requirePlaces)) {
        resolve(window.google.maps);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(
          new Error(
            requirePlaces
              ? 'Google Maps loaded but Places library is unavailable'
              : 'Timed out while waiting for Google Maps'
          )
        );
        return;
      }
      window.setTimeout(poll, 100);
    };
    poll();
  });

const loadScript = async (apiKey) =>
  new Promise((resolve, reject) => {
    if (isMapsLoaded(false)) {
      resolve(window.google.maps);
      return;
    }

    const existingScript = document.getElementById(SCRIPT_ID);
    if (existingScript) {
      if (existingScript.dataset.status === 'error') {
        existingScript.remove();
      } else {
        let settled = false;
        const finishResolve = (maps) => {
          if (settled) return;
          settled = true;
          resolve(maps);
        };
        const finishReject = (error) => {
          if (settled) return;
          settled = true;
          reject(error);
        };

        waitForMapsReady(false)
          .then((maps) => finishResolve(maps))
          .catch((error) => finishReject(error));

        existingScript.addEventListener(
          'load',
          () => {
            waitForMapsReady(false).then(finishResolve).catch(finishReject);
          },
          { once: true }
        );
        existingScript.addEventListener(
          'error',
          () => finishReject(new Error('Failed to load Google Maps script')),
          { once: true }
        );
        return;
      }
    }

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.dataset.status = 'loading';
    script.src = `${GOOGLE_MAPS_BASE_URL}?key=${encodeURIComponent(
      apiKey
    )}&libraries=places,geometry&v=weekly`;
    script.async = true;
    script.defer = true;

    const timeoutId = window.setTimeout(() => {
      script.dataset.status = 'error';
      reject(new Error('Timed out while loading Google Maps script'));
    }, SCRIPT_TIMEOUT_MS);

    script.onload = () => {
      script.dataset.status = 'loaded';
      waitForMapsReady(false)
        .then((maps) => {
          script.dataset.status = 'ready';
          window.clearTimeout(timeoutId);
          resolve(maps);
        })
        .catch((error) => {
          script.dataset.status = 'error';
          window.clearTimeout(timeoutId);
          reject(error);
        });
    };
    script.onerror = () => {
      script.dataset.status = 'error';
      window.clearTimeout(timeoutId);
      reject(new Error('Failed to load Google Maps script'));
    };

    document.head.appendChild(script);
  });

export const loadGoogleMapsApi = async ({ requirePlaces = false } = {}) => {
  if (isMapsLoaded(requirePlaces)) {
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

  const maps = await googleMapsPromise;
  if (requirePlaces && !isMapsLoaded(true)) {
    throw new Error('Google Maps loaded but Places library is unavailable');
  }
  return maps;
};
