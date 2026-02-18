import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import API from '../api/axios';
import { loadGoogleMapsApi } from '../utils/googleMaps';

const INDIA_CENTER = { lat: 20.5937, lng: 78.9629 };

const isValidCoords = (point) =>
  Number.isFinite(Number(point?.lat)) &&
  Number.isFinite(Number(point?.lng)) &&
  (Number(point.lat) !== 0 || Number(point.lng) !== 0);

const toCoords = (point) => ({ lat: Number(point.lat), lng: Number(point.lng) });

const markerCircle = (maps, color, scale = 9) => ({
  path: maps.SymbolPath.CIRCLE,
  fillColor: color,
  fillOpacity: 1,
  strokeColor: '#0b1220',
  strokeWeight: 2,
  scale,
});

export default function DriverCurrentRide() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState(null);
  const [myRides, setMyRides] = useState([]);
  const [driverLocation, setDriverLocation] = useState(null);
  const [navigationInfo, setNavigationInfo] = useState(null);
  const [mapsReady, setMapsReady] = useState(false);
  const [mapsError, setMapsError] = useState('');
  const [otpInput, setOtpInput] = useState('');
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [locationPermissionDenied, setLocationPermissionDenied] = useState(false);

  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const directionsServiceRef = useRef(null);
  const directionsRendererRef = useRef(null);
  const markerRefs = useRef({});
  const geocoderRef = useRef(null);
  const watchIdRef = useRef(null);
  const lastLocationSyncRef = useRef(0);
  const mapTypeRef = useRef('roadmap');

  const activeRide = useMemo(
    () => myRides.find((ride) => ['accepted', 'in_progress'].includes(ride.status)),
    [myRides]
  );

  const isPrePickupPhase = !!(
    activeRide &&
    activeRide.status === 'accepted' &&
    !activeRide.pickupOtpVerifiedAt
  );

  const routeTarget = useMemo(() => {
    if (!activeRide) return null;
    if (isPrePickupPhase) {
      return isValidCoords(activeRide.userLiveLocation) ? activeRide.userLiveLocation : activeRide.pickup;
    }
    return activeRide.dropoff;
  }, [activeRide, isPrePickupPhase]);

  const fetchData = useCallback(async () => {
    try {
      const [profileRes, ridesRes] = await Promise.all([
        API.get('/driver/profile'),
        API.get('/driver/my-rides'),
      ]);

      const nextProfile = profileRes.data.driver;
      setProfile(nextProfile);
      setMyRides(ridesRes.data.rides || []);

      if (!driverLocation && isValidCoords(nextProfile?.currentLocation)) {
        setDriverLocation(toCoords(nextProfile.currentLocation));
      }
    } catch (error) {
      toast.error('Failed to load current ride');
    } finally {
      setLoading(false);
    }
  }, [driverLocation]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const reverseGeocode = useCallback(
    (coords) =>
      new Promise((resolve) => {
        if (!geocoderRef.current) return resolve('');
        geocoderRef.current.geocode({ location: coords }, (results, status) => {
          if (status !== 'OK' || !results?.[0]) return resolve('');
          resolve(results[0].formatted_address);
        });
      }),
    []
  );

  const syncDriverLocation = useCallback(
    async (coords) => {
      const now = Date.now();
      if (now - lastLocationSyncRef.current < 10000) return;
      lastLocationSyncRef.current = now;

      const address = await reverseGeocode(coords);
      await API.put('/driver/location', { lat: coords.lat, lng: coords.lng, address }).catch(() => null);
    },
    [reverseGeocode]
  );

  useEffect(() => {
    let disposed = false;

    (async () => {
      try {
        const maps = await loadGoogleMapsApi();
        if (disposed || !mapContainerRef.current) return;

        mapRef.current = new maps.Map(mapContainerRef.current, {
          center: INDIA_CENTER,
          zoom: 5,
          minZoom: 4,
          maxZoom: 19,
          mapTypeId: 'roadmap',
          streetViewControl: false,
          fullscreenControl: true,
          mapTypeControl: true,
        });

        geocoderRef.current = new maps.Geocoder();
        directionsServiceRef.current = new maps.DirectionsService();
        directionsRendererRef.current = new maps.DirectionsRenderer({
          map: mapRef.current,
          suppressMarkers: true,
          polylineOptions: {
            strokeColor: '#f59e0b',
            strokeOpacity: 0.9,
            strokeWeight: 6,
          },
        });

        setMapsReady(true);
      } catch (error) {
        setMapsError(error.message || 'Failed to load map');
      }
    })();

    return () => {
      disposed = true;
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      directionsRendererRef.current?.setMap(null);
    };
  }, []);

  useEffect(() => {
    if (!navigator.geolocation) return;

    const onPosition = (position) => {
      const coords = { lat: position.coords.latitude, lng: position.coords.longitude };
      setDriverLocation(coords);
      setLocationPermissionDenied(false);
      void syncDriverLocation(coords);
    };

    const onError = (error) => {
      if (error.code === error.PERMISSION_DENIED) {
        setLocationPermissionDenied(true);
      }
    };

    navigator.geolocation.getCurrentPosition(onPosition, onError, {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 7000,
    });

    watchIdRef.current = navigator.geolocation.watchPosition(onPosition, onError, {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 7000,
    });

    return () => {
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, [syncDriverLocation]);

  useEffect(() => {
    const maps = window.google?.maps;
    const map = mapRef.current;
    if (!mapsReady || !maps || !map) return;

    const setMarker = (key, position, title, color, label) => {
      if (!position) return;
      if (!markerRefs.current[key]) markerRefs.current[key] = new maps.Marker({ map });
      markerRefs.current[key].setPosition(position);
      markerRefs.current[key].setTitle(title || '');
      markerRefs.current[key].setVisible(true);
      if (color) markerRefs.current[key].setIcon(markerCircle(maps, color));
      markerRefs.current[key].setLabel(label || null);
    };

    const hideMarker = (key) => markerRefs.current[key]?.setVisible(false);

    if (!activeRide) {
      directionsRendererRef.current?.set('directions', null);
      ['driver', 'pickup', 'dropoff', 'riderLive', 'target'].forEach(hideMarker);
      setNavigationInfo(null);
      return;
    }

    if (isValidCoords(driverLocation)) {
      setMarker('driver', driverLocation, 'Driver', null, null);
      markerRefs.current.driver?.setIcon('https://maps.gstatic.com/mapfiles/ms2/micons/cabs.png');
    }
    if (isValidCoords(activeRide.pickup)) {
      setMarker('pickup', toCoords(activeRide.pickup), 'Pickup', '#f59e0b', {
        text: 'P',
        color: '#0b1220',
        fontWeight: '700',
      });
    }
    if (isValidCoords(activeRide.dropoff)) {
      setMarker('dropoff', toCoords(activeRide.dropoff), 'Drop-off', '#38bdf8', {
        text: 'D',
        color: '#0b1220',
        fontWeight: '700',
      });
    }
    if (isValidCoords(activeRide.userLiveLocation)) {
      setMarker('riderLive', toCoords(activeRide.userLiveLocation), 'Passenger live', '#22c55e', {
        text: 'U',
        color: '#0b1220',
        fontWeight: '700',
      });
    } else {
      hideMarker('riderLive');
    }

    if (isValidCoords(routeTarget)) {
      setMarker('target', toCoords(routeTarget), 'Target', '#22c55e', {
        text: 'T',
        color: '#0b1220',
        fontWeight: '700',
      });
    }

    const origin = isValidCoords(driverLocation)
      ? driverLocation
      : isValidCoords(profile?.currentLocation)
        ? toCoords(profile.currentLocation)
        : null;

    if (!origin || !isValidCoords(routeTarget)) {
      directionsRendererRef.current?.set('directions', null);
      setNavigationInfo(null);
      return;
    }

    directionsServiceRef.current.route(
      {
        origin,
        destination: toCoords(routeTarget),
        travelMode: maps.TravelMode.DRIVING,
      },
      (result, status) => {
        if (status !== 'OK' || !result?.routes?.[0]?.legs?.[0]) {
          setNavigationInfo(null);
          return;
        }

        directionsRendererRef.current?.setDirections(result);
        map.fitBounds(result.routes[0].bounds, 70);
        const leg = result.routes[0].legs[0];
        setNavigationInfo({
          distanceText: leg.distance?.text || '',
          durationText: leg.duration?.text || '',
        });
      }
    );
  }, [mapsReady, activeRide, routeTarget, driverLocation, profile]);

  const verifyOtp = async () => {
    if (!activeRide?._id) return;
    if (!/^\d{4}$/.test(otpInput.trim())) {
      toast.error('Enter valid 4-digit OTP');
      return;
    }
    setOtpVerifying(true);
    try {
      await API.put(`/driver/verify-pickup-otp/${activeRide._id}`, { otp: otpInput.trim() });
      toast.success('OTP verified');
      setOtpInput('');
      await fetchData();
    } catch (error) {
      toast.error(error.response?.data?.message || 'OTP verification failed');
    } finally {
      setOtpVerifying(false);
    }
  };

  const updateRideStatus = async () => {
    if (!activeRide?._id) return;
    const nextStatus = activeRide.status === 'accepted' ? 'in_progress' : 'completed';
    setStatusUpdating(true);
    try {
      await API.put(`/driver/update-ride/${activeRide._id}`, { status: nextStatus });
      toast.success(nextStatus === 'completed' ? 'Ride completed' : 'Trip started');
      await fetchData();
      if (nextStatus === 'completed') {
        navigate('/driver');
      }
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to update ride status');
    } finally {
      setStatusUpdating(false);
    }
  };

  const toggleMapType = () => {
    const map = mapRef.current;
    if (!map) return;
    mapTypeRef.current = mapTypeRef.current === 'roadmap' ? 'satellite' : 'roadmap';
    map.setMapTypeId(mapTypeRef.current);
  };

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
        <p style={{ color: 'var(--text-secondary)' }}>Loading current ride...</p>
      </div>
    );
  }

  if (!activeRide) {
    return (
      <div className="page">
        <div className="container">
          <div className="empty-state">
            <div className="empty-state-icon">-</div>
            <h3>No active ride</h3>
            <p>Accept a ride from dashboard to start navigation.</p>
            <button className="btn btn-primary" onClick={() => navigate('/driver')}>
              Back to Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="container" style={{ maxWidth: 1200 }}>
        <div className="flex-between" style={{ marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
          <div className="page-header" style={{ marginBottom: 0 }}>
            <h1>
              Current <span>Ride</span>
            </h1>
            <p>
              {isPrePickupPhase
                ? 'Navigate to passenger pickup and verify OTP.'
                : 'OTP verified. Navigate to destination.'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={toggleMapType} disabled={!mapsReady}>
              Toggle View
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/driver')}>
              Dashboard
            </button>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
            Passenger: <strong style={{ color: 'var(--text-primary)' }}>{activeRide.userId?.name}</strong>
            &nbsp;({activeRide.userId?.phone})
          </div>
          <div style={{ marginTop: 4, fontSize: 14, color: 'var(--text-secondary)' }}>
            Fare: <strong style={{ color: 'var(--amber)' }}>Rs {activeRide.fare}</strong>
            &nbsp;|&nbsp;Distance: {activeRide.distance} km
          </div>
          <div style={{ marginTop: 4, fontSize: 13, color: 'var(--text-secondary)' }}>
            Pickup: {activeRide.pickup.address}
          </div>
          <div style={{ marginTop: 2, fontSize: 13, color: 'var(--text-secondary)' }}>
            Drop-off: {activeRide.dropoff.address}
          </div>

          {isPrePickupPhase ? (
            <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                className="form-input"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{4}"
                maxLength={4}
                placeholder="Enter passenger OTP"
                value={otpInput}
                onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
                style={{ width: 170, padding: '8px 10px' }}
              />
              <button className="btn btn-secondary btn-sm" onClick={verifyOtp} disabled={otpVerifying}>
                {otpVerifying ? 'Verifying...' : 'Verify OTP'}
              </button>
            </div>
          ) : (
            <div style={{ marginTop: 10, color: 'var(--success)', fontSize: 13 }}>
              Pickup OTP verified at {new Date(activeRide.pickupOtpVerifiedAt).toLocaleTimeString()}
            </div>
          )}
        </div>

        <div className="map-shell">
          <div ref={mapContainerRef} className="map-canvas map-canvas-driver" style={{ height: '68vh' }} />
          {!mapsReady && !mapsError ? <div className="map-overlay">Loading map...</div> : null}
          {mapsError ? <div className="map-overlay map-overlay-error">{mapsError}</div> : null}
        </div>

        {navigationInfo ? (
          <div className="map-meta-grid" style={{ marginTop: 12 }}>
            <div className="map-meta-card">
              <span className="map-meta-label">Distance</span>
              <strong>{navigationInfo.distanceText}</strong>
            </div>
            <div className="map-meta-card">
              <span className="map-meta-label">ETA</span>
              <strong>{navigationInfo.durationText}</strong>
            </div>
            <div className="map-meta-card">
              <span className="map-meta-label">GPS</span>
              <strong>{locationPermissionDenied ? 'Permission blocked' : 'Live'}</strong>
            </div>
          </div>
        ) : null}

        <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
          <button
            className="btn btn-primary"
            onClick={updateRideStatus}
            disabled={statusUpdating || isPrePickupPhase}
            title={isPrePickupPhase ? 'Verify OTP before starting trip' : ''}
          >
            {statusUpdating
              ? 'Updating...'
              : activeRide.status === 'accepted'
                ? 'Start Trip'
                : 'Complete Trip'}
          </button>
        </div>
      </div>
    </div>
  );
}
