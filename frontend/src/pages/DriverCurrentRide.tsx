import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import API from '../api/axios';
import { loadGoogleMapsApi } from '../utils/googleMaps';
import { DriverProfile, Ride } from '../types';
import {
  connectSocket,
  joinRideRoom,
  leaveRideRoom,
  sendDriverLocation,
} from '../utils/socket';

const INDIA_CENTER = { lat: 20.5937, lng: 78.9629 };

const isValidCoords = (point?: { lat?: number; lng?: number } | null): boolean =>
  Number.isFinite(Number(point?.lat)) &&
  Number.isFinite(Number(point?.lng)) &&
  (Number(point?.lat) !== 0 || Number(point?.lng) !== 0);

const toCoords = (point: { lat?: number; lng?: number }) => ({
  lat: Number(point.lat),
  lng: Number(point.lng),
});

const markerCircle = (maps: any, color: string, scale = 9) => ({
  path: maps.SymbolPath.CIRCLE,
  fillColor: color,
  fillOpacity: 1,
  strokeColor: '#0b1220',
  strokeWeight: 2,
  scale,
});

const distanceInMeters = (
  p1: { lat: number; lng: number },
  p2: { lat: number; lng: number }
): number => {
  const R = 6371e3;
  const φ1 = (p1.lat * Math.PI) / 180;
  const φ2 = (p2.lat * Math.PI) / 180;
  const Δφ = ((p2.lat - p1.lat) * Math.PI) / 180;
  const Δλ = ((p2.lng - p1.lng) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

interface NavigationInfo {
  distanceText: string;
  durationText: string;
}

interface CachedRoute {
  origin: { lat: number; lng: number };
  target: { lat: number; lng: number };
  status: string;
}

export default function DriverCurrentRide(): React.ReactElement {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [myRides, setMyRides] = useState<Ride[]>([]);
  const [driverLocation, setDriverLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [passengerLiveLocation, setPassengerLiveLocation] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [isSocketConnected, setIsSocketConnected] = useState(false);
  const [navigationInfo, setNavigationInfo] = useState<NavigationInfo | null>(null);
  const [mapsReady, setMapsReady] = useState(false);
  const [mapsError, setMapsError] = useState('');
  const [mapRefreshing, setMapRefreshing] = useState(false);
  const [mapRefreshTick, setMapRefreshTick] = useState(0);
  const [otpInput, setOtpInput] = useState('');
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [locationPermissionDenied, setLocationPermissionDenied] = useState(false);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const directionsServiceRef = useRef<any>(null);
  const directionsRendererRef = useRef<any>(null);
  const markerRefs = useRef<Record<string, any>>({});
  const geocoderRef = useRef<any>(null);
  const watchIdRef = useRef<number | null>(null);
  const lastLocationSyncRef = useRef<number>(0);
  const mapTypeRef = useRef<string>('roadmap');
  const lastRouteRef = useRef<CachedRoute | null>(null);

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
      if (passengerLiveLocation) return passengerLiveLocation;
      return activeRide.pickup;
    }
    return activeRide.dropoff;
  }, [activeRide, isPrePickupPhase, passengerLiveLocation]);

  const routeOrigin = useMemo(() => {
    if (isValidCoords(driverLocation)) return driverLocation;
    if (isValidCoords(profile?.currentLocation)) return toCoords(profile!.currentLocation);
    return null;
  }, [driverLocation, profile]);

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

  // Polling fallback every 6 seconds
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 6000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Socket.IO real-time event subscriptions
  useEffect(() => {
    const socket = connectSocket();
    setIsSocketConnected(socket.connected);

    const onConnect = () => setIsSocketConnected(true);
    const onDisconnect = () => setIsSocketConnected(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    if (activeRide?._id) {
      joinRideRoom(activeRide._id);
    }

    const onUserLocationChanged = (payload: any) => {
      if (isValidCoords(payload)) {
        setPassengerLiveLocation({ lat: payload.lat, lng: payload.lng });
      }
    };

    const onRideCancelled = () => {
      toast.error('The passenger cancelled this trip');
      fetchData();
    };

    const onRideStatusChanged = (payload: any) => {
      if (payload?.status) {
        fetchData();
      }
    };

    socket.on('user:location_changed', onUserLocationChanged);
    socket.on('ride:cancelled', onRideCancelled);
    socket.on('ride:status_changed', onRideStatusChanged);

    return () => {
      if (activeRide?._id) {
        leaveRideRoom(activeRide._id);
      }
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('user:location_changed', onUserLocationChanged);
      socket.off('ride:cancelled', onRideCancelled);
      socket.off('ride:status_changed', onRideStatusChanged);
    };
  }, [activeRide?._id, fetchData]);

  const reverseGeocode = useCallback(
    (coords: { lat: number; lng: number }): Promise<string> =>
      new Promise((resolve) => {
        if (!geocoderRef.current) return resolve('');
        geocoderRef.current.geocode({ location: coords }, (results: any, status: string) => {
          if (status !== 'OK' || !results?.[0]) return resolve('');
          resolve(results[0].formatted_address);
        });
      }),
    []
  );

  const syncDriverLocation = useCallback(
    async (coords: { lat: number; lng: number }) => {
      // Real-time socket broadcast immediately
      sendDriverLocation(activeRide?._id, coords);

      // HTTP persistence throttled to 10s
      const now = Date.now();
      if (now - lastLocationSyncRef.current < 10000) return;
      lastLocationSyncRef.current = now;

      const address = await reverseGeocode(coords);
      await API.put('/driver/location', { lat: coords.lat, lng: coords.lng, address }).catch(() => null);
    },
    [activeRide?._id, reverseGeocode]
  );

  // Load Google Maps API
  // Load Google Maps API & initialize map canvas once trip details and container are mounted
  useEffect(() => {
    let disposed = false;

    if (loading || !activeRide || !mapContainerRef.current) return;
    if (mapRef.current) return;

    (async () => {
      try {
        const maps = await loadGoogleMapsApi();
        if (disposed || !mapContainerRef.current || mapRef.current) return;

        mapRef.current = new maps.Map(mapContainerRef.current, {
          center: INDIA_CENTER,
          zoom: 5,
          minZoom: 4,
          maxZoom: 19,
          mapTypeId: mapTypeRef.current || 'roadmap',
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
        geocoderRef.current = new maps.Geocoder();

        setMapsReady(true);
        setMapsError('');
      } catch (error: any) {
        if (!disposed) {
          setMapsError(error?.message || 'Failed to load map');
        }
      }
    })();

    return () => {
      disposed = true;
    };
  }, [loading, activeRide?._id, mapRefreshTick]);

  // Teardown map on final unmount
  useEffect(() => {
    return () => {
      directionsRendererRef.current?.setMap(null);
      mapRef.current = null;
    };
  }, []);

  // GPS Watch Position & Real-time Location Broadcast
  useEffect(() => {
    if (!navigator.geolocation) return;

    const onPosition = (position: GeolocationPosition) => {
      const coords = { lat: position.coords.latitude, lng: position.coords.longitude };
      setDriverLocation(coords);
      setLocationPermissionDenied(false);
      void syncDriverLocation(coords);
    };

    const onError = (error: GeolocationPositionError) => {
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
  }, [syncDriverLocation]);

  // Google Map Markers & Directions Rendering (with quota protection)
  useEffect(() => {
    const maps = (window as any).google?.maps;
    const map = mapRef.current;
    if (!mapsReady || !maps || !map) return;

    const setMarker = (key: string, position: any, title: string, color: string | null, label?: any) => {
      if (!position) return;
      if (!markerRefs.current[key]) markerRefs.current[key] = new maps.Marker({ map });
      markerRefs.current[key].setPosition(position);
      markerRefs.current[key].setTitle(title || '');
      markerRefs.current[key].setVisible(true);
      if (color) markerRefs.current[key].setIcon(markerCircle(maps, color));
      markerRefs.current[key].setLabel(label || null);
    };

    const hideMarker = (key: string) => markerRefs.current[key]?.setVisible(false);

    if (!activeRide) {
      directionsRendererRef.current?.set('directions', null);
      ['driver', 'pickup', 'dropoff', 'riderLive', 'target'].forEach(hideMarker);
      setNavigationInfo(null);
      lastRouteRef.current = null;
      return;
    }

    if (isValidCoords(driverLocation)) {
      setMarker('driver', driverLocation, 'Your Cab', null, null);
      markerRefs.current.driver?.setIcon({
        url: '/taxi.svg',
        scaledSize: new maps.Size(36, 36),
        anchor: new maps.Point(18, 18),
      });
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
    const currentPassengerLoc = passengerLiveLocation || (isValidCoords(activeRide.userLiveLocation) ? toCoords(activeRide.userLiveLocation!) : null);
    if (currentPassengerLoc) {
      setMarker('riderLive', currentPassengerLoc, 'Passenger live', '#22c55e', {
        text: 'U',
        color: '#0b1220',
        fontWeight: '700',
      });
    } else {
      hideMarker('riderLive');
    }

    if (isValidCoords(routeTarget)) {
      setMarker('target', toCoords(routeTarget!), 'Target', '#22c55e', {
        text: 'T',
        color: '#0b1220',
        fontWeight: '700',
      });
    }

    if (!routeOrigin || !isValidCoords(routeTarget)) {
      directionsRendererRef.current?.set('directions', null);
      setNavigationInfo(null);
      return;
    }

    const targetCoords = toCoords(routeTarget!);
    const prev = lastRouteRef.current;
    const isSamePhase = prev && prev.status === activeRide.status;
    const originShift = prev ? distanceInMeters(prev.origin, routeOrigin) : Infinity;
    const targetShift = prev ? distanceInMeters(prev.target, targetCoords) : Infinity;

    if (!prev || !isSamePhase || originShift > 80 || targetShift > 80) {
      directionsServiceRef.current.route(
        {
          origin: routeOrigin,
          destination: targetCoords,
          travelMode: maps.TravelMode.DRIVING,
        },
        (result: any, status: string) => {
          if (status !== 'OK' || !result?.routes?.[0]?.legs?.[0]) {
            setNavigationInfo(null);
            return;
          }

          lastRouteRef.current = {
            origin: routeOrigin,
            target: targetCoords,
            status: activeRide.status,
          };
          directionsRendererRef.current?.setDirections(result);
          map.fitBounds(result.routes[0].bounds, 70);
          const leg = result.routes[0].legs[0];
          setNavigationInfo({
            distanceText: leg.distance?.text || '',
            durationText: leg.duration?.text || '',
          });
        }
      );
    }
  }, [mapsReady, activeRide, routeTarget, routeOrigin, driverLocation, passengerLiveLocation, mapRefreshTick]);

  const verifyOtp = async () => {
    if (!activeRide?._id) return;
    if (!/^\d{4}$/.test(otpInput.trim())) {
      toast.error('Enter valid 4-digit OTP');
      return;
    }
    setOtpVerifying(true);
    try {
      await API.put(`/driver/verify-pickup-otp/${activeRide._id}`, { otp: otpInput.trim() });
      toast.success('OTP verified! You can now start the trip.');
      setOtpInput('');
      await fetchData();
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'OTP verification failed');
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
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Failed to update ride status');
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
        setDriverLocation(coords);
        void syncDriverLocation(coords);
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
    lastRouteRef.current = null;
    if (!mapRef.current) {
      setMapsError('');
      setMapsReady(false);
    }
    setMapRefreshTick((tick) => tick + 1);
    fetchLiveLocation();
    fetchData();
  };

  const openGoogleMapsNavigation = () => {
    if (!routeOrigin || !isValidCoords(routeTarget)) return;
    const destination = toCoords(routeTarget!);
    const url = `https://www.google.com/maps/dir/?api=1&origin=${routeOrigin.lat},${routeOrigin.lng}&destination=${destination.lat},${destination.lng}&travelmode=driving`;
    window.open(url, '_blank', 'noopener,noreferrer');
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
        <div className="container" style={{ maxWidth: 680 }}>
          <div className="card empty-state" style={{ padding: 40, textAlign: 'center' }}>
            <span style={{ fontSize: 48 }}>🚗</span>
            <h2 style={{ margin: '16px 0 8px', fontFamily: 'var(--font-display)' }}>No Active Ride</h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>
              Accept a ride from the dashboard to start navigation.
            </p>
            <button className="btn btn-primary" onClick={() => navigate('/driver')}>
              Back to Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  const passengerName =
    typeof activeRide.userId === 'object' ? activeRide.userId?.name : 'Passenger';
  const passengerPhone =
    typeof activeRide.userId === 'object' ? activeRide.userId?.phone : '';

  return (
    <div className="page">
      <div className="container" style={{ maxWidth: 1200 }}>
        <div className="flex-between" style={{ marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
          <div className="page-header" style={{ marginBottom: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <h1 style={{ margin: 0 }}>
                Current <span>Ride</span>
              </h1>
              <span
                style={{
                  fontSize: 11,
                  padding: '3px 8px',
                  borderRadius: 20,
                  fontWeight: 600,
                  background: isSocketConnected ? 'rgba(34, 197, 94, 0.15)' : 'rgba(234, 179, 8, 0.15)',
                  color: isSocketConnected ? '#22c55e' : '#eab308',
                  border: `1px solid ${isSocketConnected ? 'rgba(34, 197, 94, 0.3)' : 'rgba(234, 179, 8, 0.3)'}`,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: isSocketConnected ? '#22c55e' : '#eab308',
                  }}
                />
                {isSocketConnected ? 'Live Real-Time' : 'Polling'}
              </span>
            </div>
            <p>
              {isPrePickupPhase
                ? 'Navigate to passenger pickup and verify OTP.'
                : 'OTP verified. Navigate to destination.'}
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
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/driver')}>
              Dashboard
            </button>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
            Passenger: <strong style={{ color: 'var(--text-primary)' }}>{passengerName}</strong>
            &nbsp;({passengerPhone})
          </div>
          <div style={{ marginTop: 4, fontSize: 14, color: 'var(--text-secondary)' }}>
            Fare: <strong style={{ color: 'var(--amber)' }}>₹{activeRide.fare}</strong>
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
              Pickup OTP verified at{' '}
              {activeRide.pickupOtpVerifiedAt
                ? new Date(activeRide.pickupOtpVerifiedAt).toLocaleTimeString()
                : ''}
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
            disabled={mapRefreshing}
            style={{ position: 'absolute', right: 14, top: 14, zIndex: 3 }}
          >
            {mapRefreshing ? 'Refreshing...' : 'Refresh Map'}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={openGoogleMapsNavigation}
            disabled={!routeOrigin || !isValidCoords(routeTarget)}
            style={{ position: 'absolute', right: 14, bottom: 14, zIndex: 3 }}
          >
            Navigate
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
