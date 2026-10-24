import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import API from '../api/axios';
import { loadGoogleMapsApi } from '../utils/googleMaps';
import { Ride } from '../types';
import {
  connectSocket,
  joinRideRoom,
  leaveRideRoom,
  sendUserLocation,
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

const formatCountdown = (seconds: number): string => {
  const safe = Math.max(0, Number(seconds || 0));
  const mm = String(Math.floor(safe / 60)).padStart(2, '0');
  const ss = String(safe % 60).padStart(2, '0');
  return `${mm}:${ss}`;
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

export default function UserCurrentRide(): React.ReactElement {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const selectedRideId = searchParams.get('rideId');

  const [loading, setLoading] = useState(true);
  const [rides, setRides] = useState<Ride[]>([]);
  const [nowMs, setNowMs] = useState(Date.now());
  const [boostBy, setBoostBy] = useState<string | number>(20);
  const [actionLoading, setActionLoading] = useState('');
  const [mapRefreshing, setMapRefreshing] = useState(false);
  const [mapRefreshTick, setMapRefreshTick] = useState(0);
  const [mapsReady, setMapsReady] = useState(false);
  const [mapsError, setMapsError] = useState('');
  const [navigationInfo, setNavigationInfo] = useState<NavigationInfo | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [driverRealtimeLocation, setDriverRealtimeLocation] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [isSocketConnected, setIsSocketConnected] = useState(false);
  const [locationPermissionDenied, setLocationPermissionDenied] = useState(false);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const directionsServiceRef = useRef<any>(null);
  const directionsRendererRef = useRef<any>(null);
  const markerRefs = useRef<Record<string, any>>({});
  const watchIdRef = useRef<number | null>(null);
  const lastSyncRef = useRef<number>(0);
  const mapTypeRef = useRef<string>('roadmap');
  const lastRouteRef = useRef<CachedRoute | null>(null);

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

  const driverLiveLocation = useMemo(() => {
    if (driverRealtimeLocation) return driverRealtimeLocation;
    if (isValidCoords(activeRide?.driverId?.currentLocation)) {
      return toCoords(activeRide!.driverId!.currentLocation!);
    }
    return null;
  }, [driverRealtimeLocation, activeRide]);

  const routeOrigin = useMemo(() => {
    if (!activeRide) return null;
    if (isDriverSearching) {
      return isValidCoords(activeRide.pickup) ? toCoords(activeRide.pickup) : null;
    }
    if (isPrePickupPhase) {
      if (driverLiveLocation) return driverLiveLocation;
      return isValidCoords(activeRide.pickup) ? toCoords(activeRide.pickup) : null;
    }
    // In progress trip
    if (driverLiveLocation) return driverLiveLocation;
    if (isValidCoords(activeRide.pickup)) return toCoords(activeRide.pickup);
    return null;
  }, [activeRide, driverLiveLocation, isDriverSearching, isPrePickupPhase]);

  const routeTarget = useMemo(() => {
    if (!activeRide) return null;
    if (isDriverSearching) {
      return isValidCoords(activeRide.dropoff) ? toCoords(activeRide.dropoff) : null;
    }
    if (isPrePickupPhase) {
      if (!driverLiveLocation) {
        // Driver not yet located: preview trip route from pickup to dropoff
        return isValidCoords(activeRide.dropoff) ? toCoords(activeRide.dropoff) : null;
      }
      // Driver located: target is pickup location
      if (isValidCoords(activeRide.userLiveLocation)) return toCoords(activeRide.userLiveLocation!);
      return isValidCoords(activeRide.pickup) ? toCoords(activeRide.pickup) : null;
    }
    return isValidCoords(activeRide.dropoff) ? toCoords(activeRide.dropoff) : null;
  }, [activeRide, driverLiveLocation, isDriverSearching, isPrePickupPhase]);

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

  // Polling fallback every 6 seconds
  useEffect(() => {
    fetchRides();
    const interval = setInterval(fetchRides, 6000);
    return () => clearInterval(interval);
  }, [fetchRides]);

  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

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

    const onDriverLocationChanged = (payload: any) => {
      if (isValidCoords(payload)) {
        setDriverRealtimeLocation({ lat: payload.lat, lng: payload.lng });
      }
    };

    const onRideAccepted = (payload: any) => {
      toast.success('🚗 Driver matched! Heading to your pickup point.');
      if (isValidCoords(payload?.driver?.currentLocation)) {
        setDriverRealtimeLocation(toCoords(payload.driver.currentLocation));
      }
      fetchRides();
    };

    const onRideStatusChanged = (payload: any) => {
      if (payload?.status) {
        toast(`Ride updated: ${payload.status.replace('_', ' ')}`);
        fetchRides();
      }
    };

    const onRideCancelled = () => {
      toast.error('This ride was cancelled');
      fetchRides();
    };

    const onRidePriceBoosted = () => {
      fetchRides();
    };

    socket.on('driver:location_changed', onDriverLocationChanged);
    socket.on('ride:accepted', onRideAccepted);
    socket.on('ride:status_changed', onRideStatusChanged);
    socket.on('ride:cancelled', onRideCancelled);
    socket.on('ride:price_boosted', onRidePriceBoosted);

    return () => {
      if (activeRide?._id) {
        leaveRideRoom(activeRide._id);
      }
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('driver:location_changed', onDriverLocationChanged);
      socket.off('ride:accepted', onRideAccepted);
      socket.off('ride:status_changed', onRideStatusChanged);
      socket.off('ride:cancelled', onRideCancelled);
      socket.off('ride:price_boosted', onRidePriceBoosted);
    };
  }, [activeRide?._id, fetchRides]);

  // Load Google Maps API
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
      } catch (error: any) {
        setMapsError(error?.message || 'Failed to load map');
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

  // GPS Watch Position & Real-time Location Emission
  useEffect(() => {
    if (!navigator.geolocation) return;

    const onPosition = (position: GeolocationPosition) => {
      const coords = { lat: position.coords.latitude, lng: position.coords.longitude };
      setUserLocation(coords);
      setLocationPermissionDenied(false);

      if (activeRide?._id && canSyncUserLocation) {
        sendUserLocation(activeRide._id, coords);
      }
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
  }, [activeRide?._id, canSyncUserLocation]);

  // Periodic HTTP Fallback Sync for User Location
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
      ['pickup', 'dropoff', 'driver', 'user', 'target'].forEach(hideMarker);
      setNavigationInfo(null);
      lastRouteRef.current = null;
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
      setMarker('driver', driverLiveLocation, 'Driver Cab', null, null);
      markerRefs.current.driver?.setIcon({
        url: '/taxi.svg',
        scaledSize: new maps.Size(36, 36),
        anchor: new maps.Point(18, 18),
      });
    } else {
      hideMarker('driver');
    }
    if (isValidCoords(activeRide.userLiveLocation)) {
      setMarker('user', toCoords(activeRide.userLiveLocation!), 'You', '#22c55e', {
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

    // Check if re-routing is required (>80m moved or phase changed)
    const prev = lastRouteRef.current;
    const isSamePhase = prev && prev.status === activeRide.status;
    const originShift = prev ? distanceInMeters(prev.origin, routeOrigin) : Infinity;
    const targetShift = prev ? distanceInMeters(prev.target, routeTarget) : Infinity;

    if (!prev || !isSamePhase || originShift > 80 || targetShift > 80) {
      directionsServiceRef.current.route(
        {
          origin: routeOrigin,
          destination: routeTarget,
          travelMode: maps.TravelMode.DRIVING,
        },
        (result: any, status: string) => {
          if (status !== 'OK' || !result?.routes?.[0]?.legs?.[0]) {
            setNavigationInfo(null);
            return;
          }
          lastRouteRef.current = {
            origin: routeOrigin,
            target: routeTarget,
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
        if (activeRide?._id && canSyncUserLocation) {
          sendUserLocation(activeRide._id, coords);
        }
        setMapRefreshTick((tick) => tick + 1);
        setMapRefreshing(false);
      },
      () => {
        toast.error('Location permission unavailable');
        setMapRefreshing(false);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const refreshMap = () => {
    lastRouteRef.current = null;
    setMapRefreshTick((tick) => tick + 1);
    toast.success('Map updated');
  };

  const cancelRide = async () => {
    if (!activeRide) return;
    if (!window.confirm('Are you sure you want to cancel this ride?')) return;
    setActionLoading('cancel');
    try {
      await API.put(`/rides/${activeRide._id}/cancel`);
      toast.success('Ride cancelled');
      fetchRides();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Failed to cancel ride');
    } finally {
      setActionLoading('');
    }
  };

  const increaseFare = async () => {
    if (!activeRide) return;
    const increment = Number(boostBy);
    if (!increment || increment <= 0) {
      toast.error('Enter a valid boost amount');
      return;
    }
    setActionLoading('boost');
    try {
      await API.put(`/rides/${activeRide._id}/addon`, { incrementBy: increment });
      toast.success(`Fare increased by ₹${increment}`);
      fetchRides();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Failed to update fare');
    } finally {
      setActionLoading('');
    }
  };

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
        <p style={{ color: 'var(--text-secondary)' }}>Loading trip details…</p>
      </div>
    );
  }

  if (!activeRide) {
    return (
      <div className="page">
        <div className="container" style={{ maxWidth: 680 }}>
          <div className="card empty-state" style={{ padding: 40, textAlign: 'center' }}>
            <span style={{ fontSize: 48 }}>🚕</span>
            <h2 style={{ margin: '16px 0 8px', fontFamily: 'var(--font-display)' }}>No Active Trip</h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 24 }}>
              You don't have any requested, accepted, or active rides right now.
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <h1 style={{ margin: 0 }}>
                Trip to <span>{destinationLabel}</span>
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
              <strong style={{ color: 'var(--amber)' }}>₹{activeRide.fare}</strong>
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
