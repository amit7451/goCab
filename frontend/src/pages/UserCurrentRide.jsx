import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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

const formatCountdown = (seconds) => {
  const safe = Math.max(0, Number(seconds || 0));
  const mm = String(Math.floor(safe / 60)).padStart(2, '0');
  const ss = String(safe % 60).padStart(2, '0');
  return `${mm}:${ss}`;
};

export default function UserCurrentRide() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const selectedRideId = searchParams.get('rideId');

  const [loading, setLoading] = useState(true);
  const [rides, setRides] = useState([]);
  const [nowMs, setNowMs] = useState(Date.now());
  const [boostBy, setBoostBy] = useState(20);
  const [actionLoading, setActionLoading] = useState('');
  const [mapRefreshing, setMapRefreshing] = useState(false);
  const [mapRefreshTick, setMapRefreshTick] = useState(0);
  const [mapsReady, setMapsReady] = useState(false);
  const [mapsError, setMapsError] = useState('');
  const [navigationInfo, setNavigationInfo] = useState(null);
  const [userLocation, setUserLocation] = useState(null);
  const [locationPermissionDenied, setLocationPermissionDenied] = useState(false);

  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const directionsServiceRef = useRef(null);
  const directionsRendererRef = useRef(null);
  const markerRefs = useRef({});
  const watchIdRef = useRef(null);
  const lastSyncRef = useRef(0);
  const mapTypeRef = useRef('roadmap');

  const activeRide = useMemo(() => {
    if (selectedRideId) {
      const selectedRide = rides.find((ride) => ride._id === selectedRideId);
      if (selectedRide) return selectedRide;
    }

    const byPriority = ['in_progress', 'accepted', 'requested'];
    for (const status of byPriority) {
      const found = rides.find((ride) => ride.status === status);
      if (found) return found;
    }
    return null;
  }, [rides, selectedRideId]);

  const isDriverSearching = activeRide?.status === 'requested';
  const isPrePickupPhase = !!(
    activeRide &&
    activeRide.status === 'accepted' &&
    !activeRide.pickupOtpVerifiedAt
  );

  const secondsLeft = activeRide?.requestExpiresAt
    ? Math.max(0, Math.floor((new Date(activeRide.requestExpiresAt).getTime() - nowMs) / 1000))
    : 0;

  const canCancelRide = activeRide?.status === 'requested';
  const canIncreaseFare = isDriverSearching && secondsLeft > 0;
  const canSyncUserLocation = ['requested', 'accepted', 'in_progress'].includes(activeRide?.status || '');
  const destinationLabel = activeRide?.dropoff?.address?.split(',')[0] || 'destination';

  const driverLiveLocation = isValidCoords(activeRide?.driverId?.currentLocation)
    ? toCoords(activeRide.driverId.currentLocation)
    : null;

  const routeOrigin = useMemo(() => {
    if (!activeRide) return null;
    if (isDriverSearching) {
      return isValidCoords(activeRide.pickup) ? toCoords(activeRide.pickup) : null;
    }
    if (driverLiveLocation) return driverLiveLocation;
    if (isValidCoords(activeRide.pickup)) return toCoords(activeRide.pickup);
    return null;
  }, [activeRide, driverLiveLocation, isDriverSearching]);

  const routeTarget = useMemo(() => {
    if (!activeRide) return null;
    if (isDriverSearching) {
      return isValidCoords(activeRide.dropoff) ? toCoords(activeRide.dropoff) : null;
    }
    if (isPrePickupPhase) {
      if (isValidCoords(activeRide.userLiveLocation)) return toCoords(activeRide.userLiveLocation);
      return isValidCoords(activeRide.pickup) ? toCoords(activeRide.pickup) : null;
    }
    return isValidCoords(activeRide.dropoff) ? toCoords(activeRide.dropoff) : null;
  }, [activeRide, isDriverSearching, isPrePickupPhase]);

  const fetchRides = useCallback(async () => {
    try {
      const response = await API.get('/rides/my-rides');
      setRides(response.data.rides || []);
    } catch (error) {
      toast.error('Failed to load current ride');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRides();
    const interval = setInterval(fetchRides, 5000);
    return () => clearInterval(interval);
  }, [fetchRides]);

  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

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
      setUserLocation(coords);
      setLocationPermissionDenied(false);
    };
    const onError = (error) => {
      if (error.code === error.PERMISSION_DENIED) setLocationPermissionDenied(true);
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
  }, []);

  useEffect(() => {
    if (!activeRide?._id || !userLocation || !canSyncUserLocation) return;
    const now = Date.now();
    if (now - lastSyncRef.current < 10000) return;
    lastSyncRef.current = now;

    API.put(`/rides/${activeRide._id}/user-location`, {
      lat: userLocation.lat,
      lng: userLocation.lng,
      address: '',
    }).catch(() => null);
  }, [activeRide?._id, userLocation, nowMs, canSyncUserLocation]);

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
      ['pickup', 'dropoff', 'driver', 'user', 'target'].forEach(hideMarker);
      setNavigationInfo(null);
      return;
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
    if (driverLiveLocation) {
      setMarker('driver', driverLiveLocation, 'Driver', null, null);
      markerRefs.current.driver?.setIcon('https://maps.gstatic.com/mapfiles/ms2/micons/cabs.png');
    } else {
      hideMarker('driver');
    }
    if (isValidCoords(activeRide.userLiveLocation)) {
      setMarker('user', toCoords(activeRide.userLiveLocation), 'You', '#22c55e', {
        text: 'U',
        color: '#0b1220',
        fontWeight: '700',
      });
    } else if (userLocation) {
      setMarker('user', userLocation, 'You', '#22c55e', {
        text: 'U',
        color: '#0b1220',
        fontWeight: '700',
      });
    }
    if (routeTarget) {
      setMarker('target', routeTarget, 'Target', '#22c55e', {
        text: 'T',
        color: '#0b1220',
        fontWeight: '700',
      });
    }

    if (!routeOrigin || !routeTarget) {
      directionsRendererRef.current?.set('directions', null);
      setNavigationInfo(null);
      return;
    }

    directionsServiceRef.current.route(
      {
        origin: routeOrigin,
        destination: routeTarget,
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
  }, [mapsReady, activeRide, driverLiveLocation, routeOrigin, routeTarget, userLocation, mapRefreshTick]);

  const toggleMapType = () => {
    const map = mapRef.current;
    if (!map) return;
    mapTypeRef.current = mapTypeRef.current === 'roadmap' ? 'satellite' : 'roadmap';
    map.setMapTypeId(mapTypeRef.current);
  };

  const fetchLiveLocation = () => {
    setMapRefreshing(true);
    if (!navigator.geolocation) {
      setMapRefreshTick((tick) => tick + 1);
      setMapRefreshing(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coords = { lat: position.coords.latitude, lng: position.coords.longitude };
        setUserLocation(coords);
        mapRef.current?.panTo(coords);
        setMapRefreshTick((tick) => tick + 1);
        setMapRefreshing(false);
      },
      () => {
        setMapRefreshTick((tick) => tick + 1);
        setMapRefreshing(false);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  };

  const refreshMap = () => {
    if (!mapsReady) {
      setMapRefreshTick((tick) => tick + 1);
      return;
    }
    setMapRefreshTick((tick) => tick + 1);
  };

  const cancelRide = async () => {
    if (!activeRide?._id || !canCancelRide) return;
    if (!confirm('Cancel this ride?')) return;

    setActionLoading('cancel');
    try {
      await API.put(`/rides/${activeRide._id}/cancel`);
      toast.success('Ride cancelled');
      await fetchRides();
      navigate('/my-rides');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to cancel ride');
    } finally {
      setActionLoading('');
    }
  };

  const increaseFare = async () => {
    if (!activeRide?._id || !canIncreaseFare) return;
    const incrementBy = Math.max(10, Number(boostBy || 0));

    setActionLoading('boost');
    try {
      await API.put(`/rides/${activeRide._id}/addon`, { incrementBy });
      toast.success(`Fare increased by Rs ${incrementBy}`);
      await fetchRides();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to increase fare');
    } finally {
      setActionLoading('');
    }
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
            <h3>{selectedRideId ? 'Ride not found' : 'No active ride'}</h3>
            <p>
              {selectedRideId
                ? 'This ride could not be found in your account.'
                : 'Book a ride to open live tracking.'}
            </p>
            {selectedRideId ? (
              <button className="btn btn-ghost" onClick={() => navigate('/my-rides')}>
                Back to My Rides
              </button>
            ) : (
              <button className="btn btn-primary" onClick={() => navigate('/book')}>
                Book Ride
              </button>
            )}
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
              Trip to <span>{destinationLabel}</span>
            </h1>
            <p>
              {isDriverSearching
                ? 'Waiting for a driver to accept your trip.'
                : isPrePickupPhase
                  ? 'Driver is on the way to your pickup location.'
                  : activeRide.status === 'in_progress'
                    ? 'Ride in progress to destination.'
                    : `Ride status: ${activeRide.status.replace('_', ' ')}`}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={fetchLiveLocation}
              disabled={mapRefreshing}
              title="Fetch your latest GPS location"
            >
              {mapRefreshing ? 'Locating...' : 'Get Live Location'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={toggleMapType} disabled={!mapsReady}>
              Toggle View
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/my-rides')}>
              My Rides
            </button>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
            <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: '10px 12px' }}>
              <div className="map-meta-label">Status</div>
              <strong style={{ color: 'var(--text-primary)', textTransform: 'capitalize' }}>
                {activeRide.status.replace('_', ' ')}
              </strong>
            </div>
            <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: '10px 12px' }}>
              <div className="map-meta-label">Fare</div>
              <strong style={{ color: 'var(--amber)' }}>Rs {activeRide.fare}</strong>
            </div>
            <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: '10px 12px' }}>
              <div className="map-meta-label">Distance</div>
              <strong>{activeRide.distance} km</strong>
            </div>
            {isDriverSearching ? (
              <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: '10px 12px' }}>
                <div className="map-meta-label">Driver Wait Timer</div>
                <strong style={{ color: secondsLeft <= 45 ? 'var(--danger)' : 'var(--amber)' }}>
                  {formatCountdown(secondsLeft)}
                </strong>
              </div>
            ) : null}
          </div>

          <div style={{ marginTop: 12, background: 'var(--bg-elevated)', borderRadius: 10, padding: '14px 16px' }}>
            <div className="ride-stop">
              <span className="ride-stop-dot pickup" />
              <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
                <strong style={{ color: 'var(--text-primary)' }}>Pickup: </strong>
                {activeRide.pickup.address}
              </span>
            </div>
            <div className="ride-stop-line" style={{ marginLeft: 5, marginTop: 4, marginBottom: 4 }} />
            <div className="ride-stop">
              <span className="ride-stop-dot dropoff" />
              <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
                <strong style={{ color: 'var(--text-primary)' }}>Drop-off: </strong>
                {activeRide.dropoff.address}
              </span>
            </div>
          </div>

          {activeRide.status === 'accepted' && activeRide.pickupOtp && !activeRide.pickupOtpVerifiedAt ? (
            <div
              style={{
                marginTop: 12,
                background: 'rgba(16,185,129,0.12)',
                border: '1px solid rgba(16,185,129,0.35)',
                borderRadius: 10,
                padding: '12px 14px',
              }}
            >
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
                Share this pickup OTP with your driver
              </div>
              <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: 6, color: 'var(--success)' }}>
                {activeRide.pickupOtp}
              </div>
            </div>
          ) : null}
          {activeRide.pickupOtpVerifiedAt ? (
            <div style={{ marginTop: 10, color: 'var(--success)', fontSize: 13 }}>
              Pickup OTP verified at {new Date(activeRide.pickupOtpVerifiedAt).toLocaleTimeString()}
            </div>
          ) : null}

          {(canCancelRide || canIncreaseFare) && (
            <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              {canCancelRide ? (
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={cancelRide}
                  disabled={actionLoading === 'cancel'}
                >
                  {actionLoading === 'cancel' ? 'Cancelling...' : 'Cancel Ride'}
                </button>
              ) : null}

              {canIncreaseFare ? (
                <>
                  <input
                    className="form-input"
                    type="number"
                    min={10}
                    step={10}
                    value={boostBy}
                    onChange={(e) => setBoostBy(e.target.value)}
                    style={{ width: 120, padding: '8px 10px' }}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={increaseFare}
                    disabled={actionLoading === 'boost'}
                  >
                    {actionLoading === 'boost' ? 'Updating...' : 'Increase Fare'}
                  </button>
                </>
              ) : null}
            </div>
          )}
        </div>

        <div className="map-shell">
          <div ref={mapContainerRef} className="map-canvas map-canvas-driver" style={{ height: '68vh' }} />
          {!mapsReady && !mapsError ? <div className="map-overlay">Loading map...</div> : null}
          {mapsError ? <div className="map-overlay map-overlay-error">{mapsError}</div> : null}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={refreshMap}
            disabled={!mapsReady || mapRefreshing}
            style={{ position: 'absolute', right: 14, top: 14, zIndex: 3 }}
          >
            {mapRefreshing ? 'Refreshing...' : 'Refresh Map'}
          </button>
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
      </div>
    </div>
  );
}
