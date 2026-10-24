import API from '../api/axios';

const SCRIPT_ID = 'gocab-google-maps-script';
const GOOGLE_MAPS_BASE_URL = 'https://maps.googleapis.com/maps/api/js';
const SCRIPT_TIMEOUT_MS = 15000;

let mapsApiKeyPromise: Promise<string> | null = null;
let googleMapsPromise: Promise<any> | null = null;

const getEnvMapsApiKey = (): string =>
  String(import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '').trim();

const getBackendMapsApiKey = async (): Promise<string> => {
  const response = await API.get('/maps/config');
  const key = String(response?.data?.mapsApiKey || '').trim();
  if (!key) {
    throw new Error('Google Maps API key is not configured in backend');
  }
  return key;
};

export const resolveMapsApiKey = async (): Promise<string> => {
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

export const isMapsLoaded = (requirePlaces = false): boolean => {
  const google = (window as any).google;
  return requirePlaces ? !!google?.maps?.places : !!google?.maps;
};

const waitForMapsReady = (requirePlaces = false, timeoutMs = SCRIPT_TIMEOUT_MS): Promise<any> =>
  new Promise((resolve, reject) => {
    if (isMapsLoaded(requirePlaces)) {
      resolve((window as any).google.maps);
      return;
    }

    const startedAt = Date.now();
    const poll = () => {
      if (isMapsLoaded(requirePlaces)) {
        resolve((window as any).google.maps);
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

const loadScript = async (apiKey: string): Promise<any> =>
  new Promise((resolve, reject) => {
    if (isMapsLoaded(false)) {
      resolve((window as any).google.maps);
      return;
    }

    const existingScript = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existingScript) {
      if (existingScript.dataset.status === 'error') {
        existingScript.remove();
      } else {
        let settled = false;
        const finishResolve = (maps: any) => {
          if (settled) return;
          settled = true;
          resolve(maps);
        };
        const finishReject = (error: any) => {
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
    (window as any).gm_authFailure = () => {
      console.warn('Google Maps API authentication warning: Please verify your Google Cloud Maps API key restrictions and billing.');
    };

    document.head.appendChild(script);
  });

export const loadGoogleMapsApi = async ({
  requirePlaces = false,
}: { requirePlaces?: boolean } = {}): Promise<any> => {
  if (isMapsLoaded(requirePlaces)) {
    return (window as any).google.maps;
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
