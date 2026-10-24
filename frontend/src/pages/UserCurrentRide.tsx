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

  const [lastTrackedRideId, setLastTrackedRideId] = useState<string | null>(() => {
    return selectedRideId || sessionStorage.getItem('gocab_last_tracked_ride') || null;
  });
  const [hoverRating, setHoverRating] = useState<number>(0);
  const [submittingRating, setSubmittingRating] = useState<boolean>(false);

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

    if (lastTrackedRideId) {
      const trackedRide = rides.find((ride) => ride._id === lastTrackedRideId);
      if (trackedRide && (trackedRide.status === 'completed' || trackedRide.status === 'cancelled')) {
        return trackedRide;
      }
    }

    const recentCompleted = rides.find((ride) => {
      if (ride.status !== 'completed') return false;
      const finishedAt = new Date(ride.endTime || ride.updatedAt).getTime();
      return Date.now() - finishedAt < 2 * 60 * 60 * 1000;
    });
    if (recentCompleted) return recentCompleted;

    return null;
  }, [rides, selectedRideId, lastTrackedRideId]);

  useEffect(() => {
    if (activeRide?._id) {
      setLastTrackedRideId(activeRide._id);
      sessionStorage.setItem('gocab_last_tracked_ride', activeRide._id);
    }
  }, [activeRide?._id]);

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
    // In progress or completed trip: origin is pickup
    if (activeRide.status === 'completed') {
      return isValidCoords(activeRide.pickup) ? toCoords(activeRide.pickup) : null;
    }
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
        return isValidCoords(activeRide.dropoff) ? toCoords(activeRide.dropoff) : null;
      }
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
        if (payload.status === 'completed') {
          toast.success('🎉 You have arrived! Trip completed.', { duration: 5000 });
        } else {
          toast(`Ride updated: ${payload.status.replace('_', ' ')}`);
        }
        if (payload?.rideId) {
          setLastTrackedRideId(payload.rideId);
          sessionStorage.setItem('gocab_last_tracked_ride', payload.rideId);
        }
        fetchRides();
      }
    };

    const onRideCancelled = (payload: any) => {
      toast.error('This ride was cancelled');
      if (payload?.rideId) {
        setLastTrackedRideId(payload.rideId);
        sessionStorage.setItem('gocab_last_tracked_ride', payload.rideId);
      }
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

  // Load Google Maps API & initialize map canvas once trip details and container are mounted
  useEffect(() => {
    let disposed = false;

    if (loading || !activeRide || !mapContainerRef.current) return;
    if (mapRef.current && mapRef.current.getDiv() === mapContainerRef.current) return;
    if (mapRef.current && mapRef.current.getDiv() !== mapContainerRef.current) {
      mapRef.current = null;
    }

    (async () => {
      try {
        const maps = await loadGoogleMapsApi();
        if (disposed || !mapContainerRef.current) return;

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
  }, [loading, activeRide?._id, activeRide?.status, mapRefreshTick]);

  // Teardown map on final unmount
  useEffect(() => {
    return () => {
      directionsRendererRef.current?.setMap(null);
      mapRef.current = null;
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

    if (driverLiveLocation && activeRide.status !== 'completed') {
      setMarker('driver', driverLiveLocation, 'Driver Cab', null, null);
      markerRefs.current.driver?.setIcon({
        url: '/taxi.svg',
        scaledSize: new maps.Size(36, 36),
        anchor: new maps.Point(18, 18),
      });
    } else {
      hideMarker('driver');
    }

    if (activeRide.status !== 'completed') {
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
    } else {
      hideMarker('user');
      hideMarker('target');
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
    if (!mapRef.current) {
      setMapsError('');
      setMapsReady(false);
    }
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

  const handleRateDriver = async (ratingValue: number) => {
    if (!activeRide?._id || submittingRating) return;
    setSubmittingRating(true);
    try {
      await API.put(`/rides/${activeRide._id}/rate`, { rating: ratingValue });
      toast.success(`⭐ Thank you! You rated ${ratingValue} star${ratingValue > 1 ? 's' : ''}.`);
      setRides((prev) =>
        prev.map((r) => (r._id === activeRide._id ? { ...r, rating: ratingValue } : r))
      );
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Failed to submit rating');
    } finally {
      setSubmittingRating(false);
    }
  };

  const handleBookAnotherRide = () => {
    sessionStorage.removeItem('gocab_last_tracked_ride');
    setLastTrackedRideId(null);
    navigate('/book');
  };

  const handleViewAllRides = () => {
    navigate('/my-rides');
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

  // Cancelled Ride View
  if (activeRide.status === 'cancelled') {
    return (
      <div className="page">
        <div className="container" style={{ maxWidth: 680 }}>
          <div className="card" style={{ padding: 36, textAlign: 'center', borderColor: 'rgba(239, 68, 68, 0.3)' }}>
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: '50%',
                background: 'rgba(239, 68, 68, 0.15)',
                color: 'var(--danger)',
                fontSize: 32,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 16,
              }}
            >
              ✕
            </div>
            <h2 style={{ margin: '0 0 8px', fontFamily: 'var(--font-display)' }}>Ride Cancelled</h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 20 }}>
              {activeRide.cancelledReason || 'This trip has been cancelled.'}
            </p>
            <div
              style={{
                background: 'var(--bg-elevated)',
                borderRadius: 12,
                padding: '14px 18px',
                textAlign: 'left',
                marginBottom: 24,
                fontSize: 14,
              }}
            >
              <div style={{ marginBottom: 6 }}>
                <strong style={{ color: 'var(--text-primary)' }}>Pickup: </strong>
                <span style={{ color: 'var(--text-secondary)' }}>{activeRide.pickup.address}</span>
              </div>
              <div>
                <strong style={{ color: 'var(--text-primary)' }}>Drop-off: </strong>
                <span style={{ color: 'var(--text-secondary)' }}>{activeRide.dropoff.address}</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button className="btn btn-primary" onClick={handleBookAnotherRide}>
                🚕 Book Another Ride
              </button>
              <button className="btn btn-ghost" onClick={handleViewAllRides}>
                📄 View My Rides
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Completed Ride View with Full Receipt, Driver Vehicle Info, and Rating
  if (activeRide.status === 'completed') {
    return (
      <div className="page">
        <div className="container" style={{ maxWidth: 1200 }}>
          {/* Hero Banner with Actions */}
          <div
            className="card"
            style={{
              marginBottom: 20,
              background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.12) 0%, rgba(17, 29, 53, 0.8) 100%)',
              borderColor: 'rgba(16, 185, 129, 0.35)',
              padding: '24px 28px',
            }}
          >
            <div className="flex-between" style={{ gap: 16, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: '50%',
                    background: 'rgba(16, 185, 129, 0.2)',
                    border: '2px solid var(--success)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 28,
                    flexShrink: 0,
                  }}
                >
                  🎉
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <h1 style={{ margin: 0, fontSize: 26, fontFamily: 'var(--font-display)' }}>
                      Trip Completed!
                    </h1>
                    <span className="badge badge-completed" style={{ fontSize: 12 }}>
                      ✓ Safely Arrived
                    </span>
                  </div>
                  <p style={{ color: 'var(--text-secondary)', margin: '4px 0 0', fontSize: 14 }}>
                    {activeRide.endTime
                      ? `Arrived at ${new Date(activeRide.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • Destination reached successfully`
                      : 'Destination reached successfully • Thank you for choosing GoCab'}
                  </p>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleBookAnotherRide}
                  style={{ padding: '10px 20px', fontWeight: 700 }}
                >
                  🚕 Book Another Ride
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={handleViewAllRides}
                  style={{ padding: '10px 18px' }}
                >
                  📄 View My Rides
                </button>
              </div>
            </div>
          </div>

          {/* 2-Column Responsive Layout */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
              gap: 20,
              alignItems: 'start',
            }}
          >
            {/* Left Column: Receipt, Driver Info, Rating Widget */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Trip Receipt Card */}
              <div className="card" style={{ padding: 24 }}>
                <div className="flex-between" style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 20 }}>🧾</span>
                    <h3 style={{ margin: 0, fontSize: 18, fontFamily: 'var(--font-display)' }}>
                      Trip Receipt
                    </h3>
                  </div>
                  <span
                    style={{
                      padding: '4px 10px',
                      borderRadius: 20,
                      fontSize: 12,
                      fontWeight: 600,
                      background: 'rgba(16, 185, 129, 0.15)',
                      color: 'var(--success)',
                      border: '1px solid rgba(16, 185, 129, 0.3)',
                    }}
                  >
                    ✓ Paid via {activeRide.paymentMethod === 'card' ? 'Card' : 'Cash'}
                  </span>
                </div>

                {/* Fare Display */}
                <div
                  style={{
                    background: 'var(--bg-elevated)',
                    borderRadius: 14,
                    padding: '18px 20px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 16,
                    border: '1px solid var(--border)',
                  }}
                >
                  <div>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Total Fare Paid
                    </span>
                    <div style={{ fontSize: 34, fontWeight: 800, color: 'var(--amber)', fontFamily: 'var(--font-display)' }}>
                      ₹{activeRide.fare}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span
                      style={{
                        fontSize: 13,
                        textTransform: 'capitalize',
                        color: 'var(--text-primary)',
                        fontWeight: 600,
                        display: 'block',
                      }}
                    >
                      {activeRide.rideType} Ride
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {activeRide.paymentMethod === 'card' ? '💳 Online / Card' : '💵 Cash to Driver'}
                    </span>
                  </div>
                </div>

                {/* Fare Breakdown */}
                <div
                  style={{
                    background: 'rgba(8, 14, 30, 0.4)',
                    borderRadius: 10,
                    padding: '12px 14px',
                    marginBottom: 16,
                    fontSize: 13,
                  }}
                >
                  <div className="flex-between" style={{ padding: '4px 0', color: 'var(--text-secondary)' }}>
                    <span>Base Fare & Distance</span>
                    <span style={{ color: 'var(--text-primary)' }}>
                      ₹{Math.max(0, activeRide.fare - (activeRide.userPriceAddon || 0))}
                    </span>
                  </div>
                  {Boolean(activeRide.userPriceAddon) && (
                    <div className="flex-between" style={{ padding: '4px 0', color: 'var(--text-secondary)' }}>
                      <span>Priority Tip / Boost</span>
                      <span style={{ color: 'var(--amber)' }}>+₹{activeRide.userPriceAddon}</span>
                    </div>
                  )}
                  <div
                    className="flex-between"
                    style={{
                      padding: '8px 0 2px',
                      marginTop: 4,
                      borderTop: '1px solid var(--border)',
                      fontWeight: 700,
                      color: 'var(--text-primary)',
                    }}
                  >
                    <span>Final Total</span>
                    <span style={{ color: 'var(--amber)' }}>₹{activeRide.fare}</span>
                  </div>
                </div>

                {/* Metrics Grid */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: 8,
                    marginBottom: 16,
                  }}
                >
                  <div
                    style={{
                      background: 'var(--bg-elevated)',
                      borderRadius: 10,
                      padding: '10px 12px',
                      textAlign: 'center',
                    }}
                  >
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                      Distance
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }}>
                      {activeRide.distance} km
                    </div>
                  </div>
                  <div
                    style={{
                      background: 'var(--bg-elevated)',
                      borderRadius: 10,
                      padding: '10px 12px',
                      textAlign: 'center',
                    }}
                  >
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                      Duration
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }}>
                      {activeRide.estimatedDuration || 15} mins
                    </div>
                  </div>
                  <div
                    style={{
                      background: 'var(--bg-elevated)',
                      borderRadius: 10,
                      padding: '10px 12px',
                      textAlign: 'center',
                    }}
                  >
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                      Vehicle Tier
                    </div>
                    <div
                      style={{
                        fontSize: 16,
                        fontWeight: 700,
                        marginTop: 2,
                        textTransform: 'capitalize',
                        color: 'var(--amber)',
                      }}
                    >
                      {activeRide.rideType}
                    </div>
                  </div>
                </div>

                {/* Stops Recap */}
                <div
                  style={{
                    background: 'var(--bg-elevated)',
                    borderRadius: 10,
                    padding: '14px 16px',
                  }}
                >
                  <div className="ride-stop">
                    <span className="ride-stop-dot pickup" />
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                      <strong style={{ color: 'var(--text-primary)', display: 'block', fontSize: 14 }}>
                        Pickup Location
                      </strong>
                      {activeRide.pickup.address}
                      {activeRide.startTime ? (
                        <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                          Started at {new Date(activeRide.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="ride-stop-line" style={{ marginLeft: 5, marginTop: 6, marginBottom: 6 }} />
                  <div className="ride-stop">
                    <span className="ride-stop-dot dropoff" />
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                      <strong style={{ color: 'var(--text-primary)', display: 'block', fontSize: 14 }}>
                        Drop-off Destination
                      </strong>
                      {activeRide.dropoff.address}
                      {activeRide.endTime ? (
                        <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                          Completed at {new Date(activeRide.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>

              {/* Driver & Vehicle Details Card */}
              <div className="card" style={{ padding: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                  <span style={{ fontSize: 20 }}>🚗</span>
                  <h3 style={{ margin: 0, fontSize: 18, fontFamily: 'var(--font-display)' }}>
                    Your Driver & Vehicle
                  </h3>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: 'var(--bg-elevated)',
                    borderRadius: 12,
                    padding: '14px 16px',
                    flexWrap: 'wrap',
                    gap: 12,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>
                      {activeRide.driverId?.userId?.name || 'Assigned Driver'}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
                      {activeRide.driverId?.userId?.phone ? `📞 ${activeRide.driverId.userId.phone}` : 'Driver on GoCab'}
                    </div>
                  </div>
                  {activeRide.driverId?.rating ? (
                    <div
                      style={{
                        background: 'rgba(245, 158, 11, 0.15)',
                        border: '1px solid rgba(245, 158, 11, 0.3)',
                        borderRadius: 8,
                        padding: '6px 10px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        fontWeight: 700,
                        color: 'var(--amber)',
                        fontSize: 14,
                      }}
                    >
                      ⭐ {activeRide.driverId.rating.average.toFixed(1)}
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>
                        ({activeRide.driverId.rating.count} reviews)
                      </span>
                    </div>
                  ) : null}
                </div>

                {activeRide.driverId?.vehicleInfo ? (
                  <div
                    style={{
                      marginTop: 12,
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                      gap: 8,
                    }}
                  >
                    <div style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: '8px 12px' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Vehicle</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginTop: 2 }}>
                        {activeRide.driverId.vehicleInfo.make} {activeRide.driverId.vehicleInfo.model}
                      </div>
                    </div>
                    <div style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: '8px 12px' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Plate No.</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--amber)', marginTop: 2 }}>
                        {activeRide.driverId.vehicleInfo.licensePlate}
                      </div>
                    </div>
                    <div style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: '8px 12px' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Color</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginTop: 2, textTransform: 'capitalize' }}>
                        {activeRide.driverId.vehicleInfo.color}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Driver Rating Card */}
              <div
                className="card"
                style={{
                  padding: 24,
                  border: activeRide.rating ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid var(--border)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <span style={{ fontSize: 20 }}>⭐</span>
                  <h3 style={{ margin: 0, fontSize: 18, fontFamily: 'var(--font-display)' }}>
                    {activeRide.rating ? 'Driver Rating' : 'Rate Your Trip'}
                  </h3>
                </div>

                {activeRide.rating ? (
                  <div
                    style={{
                      textAlign: 'center',
                      padding: '16px 20px',
                      background: 'rgba(16, 185, 129, 0.08)',
                      borderRadius: 12,
                      border: '1px solid rgba(16, 185, 129, 0.2)',
                    }}
                  >
                    <div style={{ fontSize: 32, marginBottom: 6, letterSpacing: 4 }}>
                      {'⭐'.repeat(activeRide.rating)}
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
                      You rated this trip {activeRide.rating} out of 5 stars
                    </div>
                    <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
                      Thank you for sharing your feedback and keeping GoCab safe and reliable!
                    </p>
                  </div>
                ) : (
                  <div>
                    <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 16 }}>
                      How was your ride with {activeRide.driverId?.userId?.name || 'your driver'}? Tap a star to submit your review:
                    </p>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 12,
                        padding: '14px 0',
                        background: 'var(--bg-elevated)',
                        borderRadius: 12,
                      }}
                    >
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          type="button"
                          onClick={() => handleRateDriver(star)}
                          onMouseEnter={() => setHoverRating(star)}
                          onMouseLeave={() => setHoverRating(0)}
                          disabled={submittingRating}
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: submittingRating ? 'not-allowed' : 'pointer',
                            fontSize: 34,
                            padding: '4px 6px',
                            transition: 'transform 0.15s, opacity 0.15s',
                            transform: (hoverRating || 0) >= star ? 'scale(1.25)' : 'scale(1)',
                            opacity: (hoverRating || 0) >= star || (!hoverRating && star <= 5) ? 1 : 0.4,
                            filter: (hoverRating || 0) >= star ? 'drop-shadow(0 0 6px rgba(245, 158, 11, 0.6))' : 'none',
                          }}
                          title={`Rate ${star} star${star > 1 ? 's' : ''}`}
                        >
                          ⭐
                        </button>
                      ))}
                    </div>
                    {submittingRating ? (
                      <div style={{ textAlign: 'center', marginTop: 10, color: 'var(--text-muted)', fontSize: 13 }}>
                        Submitting rating…
                      </div>
                    ) : hoverRating > 0 ? (
                      <div style={{ textAlign: 'center', marginTop: 10, color: 'var(--amber)', fontSize: 13, fontWeight: 600 }}>
                        {hoverRating === 5 ? 'Excellent!' : hoverRating === 4 ? 'Great ride' : hoverRating === 3 ? 'Good' : hoverRating === 2 ? 'Fair' : 'Poor'}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Route Map & Navigation Details */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="card" style={{ padding: 20 }}>
                <div className="flex-between" style={{ marginBottom: 12 }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: 16, fontFamily: 'var(--font-display)' }}>
                      Completed Route
                    </h3>
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)' }}>
                      Route map from pickup to drop-off
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-ghost btn-sm" onClick={toggleMapType} disabled={!mapsReady}>
                      Toggle View
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={refreshMap} disabled={mapRefreshing}>
                      {mapRefreshing ? 'Refreshing…' : '↻ Refresh'}
                    </button>
                  </div>
                </div>

                <div className="map-shell" style={{ borderRadius: 12, overflow: 'hidden', height: 420 }}>
                  <div ref={mapContainerRef} className="map-canvas map-canvas-driver" style={{ height: '100%' }} />
                  {!mapsReady && !mapsError ? <div className="map-overlay">Loading map...</div> : null}
                  {mapsError ? <div className="map-overlay map-overlay-error">{mapsError}</div> : null}
                </div>

                {navigationInfo ? (
                  <div className="map-meta-grid" style={{ marginTop: 12 }}>
                    <div className="map-meta-card">
                      <span className="map-meta-label">Route Distance</span>
                      <strong>{navigationInfo.distanceText || `${activeRide.distance} km`}</strong>
                    </div>
                    <div className="map-meta-card">
                      <span className="map-meta-label">Route Duration</span>
                      <strong>{navigationInfo.durationText || `${activeRide.estimatedDuration || 15} mins`}</strong>
                    </div>
                    <div className="map-meta-card">
                      <span className="map-meta-label">Status</span>
                      <strong style={{ color: 'var(--success)' }}>Completed</strong>
                    </div>
                  </div>
                ) : null}
              </div>

              {/* Additional Quick Actions */}
              <div
                className="card"
                style={{
                  padding: '18px 20px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  flexWrap: 'wrap',
                }}
              >
                <div>
                  <strong style={{ display: 'block', fontSize: 14 }}>Need another cab right now?</strong>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    Quick booking with upfront pricing and nearby drivers
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={handleBookAnotherRide}
                >
                  + Book New Ride
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Active / Ongoing Trip View
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
            disabled={mapRefreshing}
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
