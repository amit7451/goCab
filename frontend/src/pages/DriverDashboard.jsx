import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import API from '../api/axios';
import { useAuth } from '../context/AuthContext';
import { loadGoogleMapsApi } from '../utils/googleMaps';

const STATUS_LABEL = { accepted: 'Pick Up Passenger', in_progress: 'Complete Ride' };
const INDIA_CENTER = { lat: 20.5937, lng: 78.9629 };

const isValidCoords = (p) =>
  Number.isFinite(Number(p?.lat)) &&
  Number.isFinite(Number(p?.lng)) &&
  (Number(p.lat) !== 0 || Number(p.lng) !== 0);
const toCoords = (p) => ({ lat: Number(p.lat), lng: Number(p.lng) });
const formatCountdown = (seconds) => {
  const safe = Math.max(0, Number(seconds || 0));
  const mm = String(Math.floor(safe / 60)).padStart(2, '0');
  const ss = String(safe % 60).padStart(2, '0');
  return `${mm}:${ss}`;
};

export default function DriverDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [availableRides, setAvailableRides] = useState([]);
  const [myRides, setMyRides] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('available');
  const [actionLoading, setActionLoading] = useState('');
  const [otpInput, setOtpInput] = useState('');
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());

  const [mapsReady, setMapsReady] = useState(false);
  const [mapsError, setMapsError] = useState('');
  const [mapTypeId, setMapTypeId] = useState('roadmap');
  const [driverLocation, setDriverLocation] = useState(null);
  const [navigationInfo, setNavigationInfo] = useState(null);
  const [locationPermissionDenied, setLocationPermissionDenied] = useState(false);

  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const geocoderRef = useRef(null);
  const directionsServiceRef = useRef(null);
  const directionsRendererRef = useRef(null);
  const markerRefs = useRef({});
  const geolocationWatchRef = useRef(null);
  const lastLocationSyncRef = useRef(0);
  const knownFareRef = useRef({});

  const fetchAll = useCallback(async () => {
    try {
      const [profileRes, availRes, myRidesRes] = await Promise.all([
        API.get('/driver/profile'),
        API.get('/driver/available-rides'),
        API.get('/driver/my-rides'),
      ]);
      const nextProfile = profileRes.data.driver;
      const nextAvailable = availRes.data.rides || [];

      nextAvailable.forEach((ride) => {
        const prev = knownFareRef.current[ride._id];
        if (Number.isFinite(prev) && prev !== ride.fare) {
          toast(`Fare updated: Rs ${prev} -> Rs ${ride.fare}`);
        }
        knownFareRef.current[ride._id] = ride.fare;
      });

      setProfile(nextProfile);
      setAvailableRides(nextAvailable);
      setMyRides(myRidesRes.data.rides || []);
      if (isValidCoords(nextProfile?.currentLocation)) {
        setDriverLocation((prev) => prev || toCoords(nextProfile.currentLocation));
      }
    } catch (err) {
      toast.error('Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 8000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const activeRide = useMemo(
    () => myRides.find((r) => ['accepted', 'in_progress'].includes(r.status)),
    [myRides]
  );

  const activeDestination = useMemo(() => {
    if (!activeRide) return null;
    if (activeRide.status === 'accepted' && isValidCoords(activeRide.userLiveLocation)) return activeRide.userLiveLocation;
    return activeRide.status === 'accepted' ? activeRide.pickup : activeRide.dropoff;
  }, [activeRide]);
  const activeRideRequiresOtp = !!(
    activeRide &&
    activeRide.status === 'accepted' &&
    activeRide.pickupOtpGeneratedAt &&
    !activeRide.pickupOtpVerifiedAt
  );

  const setMarker = (key, map, maps, position, title, color, label) => {
    if (!position) return;
    if (!markerRefs.current[key]) {
      markerRefs.current[key] = new maps.Marker({ map });
    }
    markerRefs.current[key].setPosition(position);
    markerRefs.current[key].setTitle(title || '');
    markerRefs.current[key].setVisible(true);
    if (color) {
      markerRefs.current[key].setIcon({
        path: maps.SymbolPath.CIRCLE,
        fillColor: color,
        fillOpacity: 1,
        strokeColor: '#0b1220',
        strokeWeight: 2,
        scale: 8,
      });
    }
    markerRefs.current[key].setLabel(label || null);
  };

  const hideMarker = (key) => markerRefs.current[key]?.setVisible(false);

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
      if (now - lastLocationSyncRef.current < 12000) return;
      lastLocationSyncRef.current = now;
      const address = await reverseGeocode(coords);
      try {
        await API.put('/driver/location', { lat: coords.lat, lng: coords.lng, address });
      } catch {}
    },
    [reverseGeocode]
  );

  useEffect(() => {
    if (!activeRide || mapsReady) return;
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
          polylineOptions: { strokeColor: '#f59e0b', strokeOpacity: 0.9, strokeWeight: 6 },
        });
        setMapsReady(true);
      } catch (err) {
        setMapsError(err.message || 'Failed to initialize Google Maps');
      }
    })();
    return () => {
      disposed = true;
    };
  }, [activeRide, mapsReady]);

  useEffect(
    () => () => {
      if (geolocationWatchRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(geolocationWatchRef.current);
      }
      directionsRendererRef.current?.setMap(null);
    },
    []
  );

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

    // Trigger permission prompt as soon as dashboard loads.
    navigator.geolocation.getCurrentPosition(onPosition, onError, {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 7000,
    });

    geolocationWatchRef.current = navigator.geolocation.watchPosition(
      onPosition,
      onError,
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 7000 }
    );

    return () => {
      if (geolocationWatchRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(geolocationWatchRef.current);
      }
    };
  }, [syncDriverLocation]);

  useEffect(() => {
    const map = mapRef.current;
    const maps = window.google?.maps;
    if (!mapsReady || !map || !maps) return;

    if (!activeRide) {
      directionsRendererRef.current?.set('directions', null);
      ['pickup', 'dropoff', 'driver', 'destination', 'riderLive'].forEach(hideMarker);
      setNavigationInfo(null);
      return;
    }

    if (isValidCoords(activeRide.pickup)) {
      setMarker('pickup', map, maps, toCoords(activeRide.pickup), 'Pickup', '#f59e0b', { text: 'P', color: '#0b1220', fontWeight: '700' });
    }
    if (isValidCoords(activeRide.dropoff)) {
      setMarker('dropoff', map, maps, toCoords(activeRide.dropoff), 'Drop-off', '#38bdf8', { text: 'D', color: '#0b1220', fontWeight: '700' });
    }
    if (isValidCoords(activeRide.userLiveLocation)) {
      setMarker('riderLive', map, maps, toCoords(activeRide.userLiveLocation), 'Passenger live', '#22c55e', { text: 'U', color: '#0b1220', fontWeight: '700' });
    } else {
      hideMarker('riderLive');
    }
    if (driverLocation) {
      setMarker('driver', map, maps, driverLocation, 'Driver live', null, null);
      markerRefs.current.driver?.setIcon('https://maps.gstatic.com/mapfiles/ms2/micons/cabs.png');
    }

    if (!driverLocation || !isValidCoords(activeDestination)) {
      directionsRendererRef.current?.set('directions', null);
      setNavigationInfo(null);
      return;
    }

    setMarker('destination', map, maps, toCoords(activeDestination), 'Target', '#22c55e', { text: 'T', color: '#0b1220', fontWeight: '700' });
    directionsServiceRef.current.route(
      { origin: driverLocation, destination: toCoords(activeDestination), travelMode: maps.TravelMode.DRIVING },
      (result, status) => {
        if (status !== 'OK' || !result?.routes?.[0]?.legs?.[0]) return setNavigationInfo(null);
        directionsRendererRef.current?.setDirections(result);
        map.fitBounds(result.routes[0].bounds, 70);
        const leg = result.routes[0].legs[0];
        setNavigationInfo({
          distanceText: leg.distance?.text || '',
          durationText: leg.duration?.text || '',
        });
      }
    );
  }, [mapsReady, activeRide, activeDestination, driverLocation]);

  const toggleAvailability = async () => {
    try {
      const res = await API.put('/driver/availability', { isAvailable: !profile.isAvailable });
      setProfile(res.data.driver);
      toast.success(res.data.message);
    } catch {
      toast.error('Failed to update availability');
    }
  };

  const acceptRide = async (rideId) => {
    setActionLoading(rideId);
    try {
      await API.put(`/driver/accept-ride/${rideId}`);
      toast.success('Ride accepted.');
      await fetchAll();
      setTab('my-rides');
      navigate('/driver/current-ride');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to accept ride');
    } finally {
      setActionLoading('');
    }
  };

  const verifyPickupOtp = async () => {
    if (!activeRide?._id) return;
    const otp = otpInput.trim();
    if (!/^\d{4}$/.test(otp)) {
      toast.error('Enter valid 4-digit OTP');
      return;
    }

    setOtpVerifying(true);
    try {
      await API.put(`/driver/verify-pickup-otp/${activeRide._id}`, { otp });
      toast.success('Passenger verified. You can start trip now.');
      setOtpInput('');
      await fetchAll();
    } catch (err) {
      toast.error(err.response?.data?.message || 'OTP verification failed');
    } finally {
      setOtpVerifying(false);
    }
  };

  const updateRideStatus = async (rideId, currentStatus) => {
    const nextStatus = currentStatus === 'accepted' ? 'in_progress' : 'completed';
    setActionLoading(rideId);
    try {
      await API.put(`/driver/update-ride/${rideId}`, { status: nextStatus });
      toast.success(nextStatus === 'completed' ? 'Ride completed.' : 'Ride started.');
      await fetchAll();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update ride');
    } finally {
      setActionLoading('');
    }
  };

  const toggleMapType = () => {
    const next = mapTypeId === 'roadmap' ? 'satellite' : 'roadmap';
    setMapTypeId(next);
    mapRef.current?.setMapTypeId(next);
  };

  const openGoogleMapsNavigation = () => {
    if (!driverLocation || !isValidCoords(activeDestination)) return;
    const url = `https://www.google.com/maps/dir/?api=1&origin=${driverLocation.lat},${driverLocation.lng}&destination=${Number(activeDestination.lat)},${Number(activeDestination.lng)}&travelmode=driving`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  if (loading) {
    return <div className="loading-screen"><div className="spinner" /><p style={{ color: 'var(--text-secondary)' }}>Loading dashboard...</p></div>;
  }

  return (
    <div className="page">
      <div className="container">
        <div className="flex-between" style={{ marginBottom: 32 }}>
          <div className="page-header" style={{ marginBottom: 0 }}>
            <h1>Driver <span>Dashboard</span></h1>
            <p>Welcome back, {user?.name?.split(' ')[0]}</p>
          </div>
          {profile && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 14, color: 'var(--text-secondary)', fontWeight: 500 }}>{profile.isAvailable ? 'Online' : 'Offline'}</span>
              <label className="toggle">
                <input type="checkbox" checked={profile.isAvailable} onChange={toggleAvailability} />
                <span className="toggle-slider" />
              </label>
            </div>
          )}
        </div>

        <div className="stats-grid">
          <div className="stat-card"><div className="stat-value">{profile?.totalRides || 0}</div><div className="stat-label">Total Rides</div></div>
          <div className="stat-card"><div className="stat-value" style={{ fontSize: 24 }}>Rs {(profile?.earnings || 0).toFixed(0)}</div><div className="stat-label">Total Earnings</div></div>
          <div className="stat-card"><div className="stat-value">{profile?.rating?.count > 0 ? profile.rating.average : '-'}</div><div className="stat-label">Avg Rating</div></div>
          <div className="stat-card"><div className="stat-value">{availableRides.length}</div><div className="stat-label">Nearby Requests</div></div>
        </div>

        {profile?.vehicleInfo && (
          <div className="card" style={{ marginBottom: 24 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18 }}>
              {profile.vehicleInfo.color} {profile.vehicleInfo.make} {profile.vehicleInfo.model} ({profile.vehicleInfo.year})
            </div>
            <div style={{ color: 'var(--text-secondary)', fontSize: 14, marginTop: 4 }}>
              {profile.vehicleInfo.licensePlate} | Categories: {(profile.vehicleInfo.categories || []).join(', ') || 'economy'}
            </div>
          </div>
        )}

        {activeRide && (
          <div className="card" style={{ marginBottom: 24 }}>
            <div className="flex-between" style={{ gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ color: 'var(--amber)', fontWeight: 700 }}>Active Ride</div>
                <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Passenger: {activeRide.userId?.name} ({activeRide.userId?.phone})</div>
                <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Fare: Rs {activeRide.fare} | Distance: {activeRide.distance} km {activeRide.userPriceAddon ? `| Add-on: +Rs ${activeRide.userPriceAddon}` : ''}</div>
                {activeRideRequiresOtp ? (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
                      Ask passenger for 4-digit OTP before pickup
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <input
                        className="form-input"
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]{4}"
                        maxLength={4}
                        placeholder="Enter OTP"
                        value={otpInput}
                        onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
                        style={{ width: 120, padding: '8px 10px' }}
                      />
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={verifyPickupOtp}
                        disabled={otpVerifying}
                      >
                        {otpVerifying ? 'Verifying...' : 'Verify OTP'}
                      </button>
                    </div>
                  </div>
                ) : null}
                {activeRide.pickupOtpVerifiedAt ? (
                  <div style={{ fontSize: 13, color: 'var(--success)', marginTop: 8 }}>
                    Passenger OTP verified at {new Date(activeRide.pickupOtpVerifiedAt).toLocaleTimeString()}
                  </div>
                ) : null}
              </div>
              <button
                onClick={() => updateRideStatus(activeRide._id, activeRide.status)}
                className="btn btn-primary"
                disabled={actionLoading === activeRide._id || activeRideRequiresOtp}
                title={activeRideRequiresOtp ? 'Verify pickup OTP first' : ''}
              >
                {actionLoading === activeRide._id ? 'Updating...' : STATUS_LABEL[activeRide.status]}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => navigate('/driver/current-ride')}
              >
                Open Current Ride
              </button>
            </div>
          </div>
        )}

        {activeRide && (
          <div className="card" style={{ marginBottom: 24 }}>
            <div className="flex-between" style={{ marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18 }}>Live Navigation</div>
                <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Driver location to target route</div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={toggleMapType} disabled={!mapsReady}>{mapTypeId === 'roadmap' ? 'Satellite View' : 'Road View'}</button>
                <button type="button" className="btn btn-primary btn-sm" onClick={openGoogleMapsNavigation} disabled={!driverLocation || !isValidCoords(activeDestination)}>Open in Google Maps</button>
              </div>
            </div>
            <div className="map-shell">
              <div ref={mapContainerRef} className="map-canvas map-canvas-driver" />
              {!mapsReady && !mapsError && <div className="map-overlay">Loading navigation map...</div>}
              {mapsError && <div className="map-overlay map-overlay-error">{mapsError}</div>}
            </div>
            {navigationInfo && <div className="map-meta-grid" style={{ marginTop: 14 }}>
              <div className="map-meta-card"><span className="map-meta-label">Distance</span><strong>{navigationInfo.distanceText}</strong></div>
              <div className="map-meta-card"><span className="map-meta-label">ETA</span><strong>{navigationInfo.durationText}</strong></div>
              <div className="map-meta-card"><span className="map-meta-label">GPS</span><strong>{driverLocation ? 'Live' : 'Waiting'}</strong></div>
            </div>}
            {locationPermissionDenied && <p style={{ marginTop: 8, color: 'var(--danger)', fontSize: 13 }}>Location permission is blocked. Enable browser GPS.</p>}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginBottom: 24, borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
          {[{ id: 'available', label: `Available (${availableRides.length})` }, { id: 'my-rides', label: `My Rides (${myRides.length})` }].map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} className={`btn btn-sm ${tab === t.id ? 'btn-primary' : 'btn-ghost'}`}>{t.label}</button>
          ))}
          <button onClick={fetchAll} className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }}>Refresh</button>
        </div>

        {tab === 'available' && (
          <>
            {availableRides.length === 0 ? (
              <div className="empty-state"><div className="empty-state-icon">-</div><h3>No rides in your range right now</h3><p>Only nearby rides matching your categories are listed.</p></div>
            ) : (
              <div className="rides-grid">
                {availableRides.map((ride) => {
                  const secondsLeft = ride.requestExpiresAt ? Math.max(0, Math.floor((new Date(ride.requestExpiresAt).getTime() - nowMs) / 1000)) : Math.max(0, Number(ride.secondsLeft || 0));
                  return (
                    <div key={ride._id} className="card">
                      <div className="flex-between" style={{ marginBottom: 12 }}>
                        <div><div style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>{ride.userId?.name}</div><div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{ride.userId?.phone}</div></div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ color: 'var(--amber)', fontWeight: 800, fontSize: 20 }}>Rs {ride.fare}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{ride.distance} km {ride.estimatedDuration ? `| ${ride.estimatedDuration} min` : ''}</div>
                        </div>
                      </div>
                      <div style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: '12px 14px', marginBottom: 12, fontSize: 13 }}>
                        <div style={{ marginBottom: 6 }}><span style={{ color: 'var(--text-muted)' }}>From: </span><strong>{ride.pickup.address}</strong></div>
                        <div style={{ marginBottom: 6 }}><span style={{ color: 'var(--text-muted)' }}>To: </span><strong>{ride.dropoff.address}</strong></div>
                        <div style={{ color: 'var(--text-secondary)' }}>Waiting timer: <strong style={{ color: secondsLeft <= 45 ? 'var(--danger)' : 'var(--amber)' }}>{formatCountdown(secondsLeft)}</strong></div>
                        {Number.isFinite(ride.pickupDistanceKm) && <div style={{ color: 'var(--text-secondary)' }}>Distance to pickup: {ride.pickupDistanceKm} km (range {ride.dispatchRadiusKm} km)</div>}
                        {!!ride.userPriceAddon && <div style={{ color: 'var(--success)' }}>Rider add-on: +Rs {ride.userPriceAddon}</div>}
                      </div>
                      <div className="flex-between" style={{ gap: 10 }}>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <span style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', fontSize: 12 }}>{ride.rideType}</span>
                          <span style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', fontSize: 12 }}>{ride.paymentMethod}</span>
                        </div>
                        <button onClick={() => acceptRide(ride._id)} className="btn btn-primary btn-sm" disabled={!!actionLoading || !profile?.isAvailable || secondsLeft <= 0}>
                          {actionLoading === ride._id ? 'Accepting...' : 'Accept Ride'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {tab === 'my-rides' && (
          <>
            {myRides.length === 0 ? (
              <div className="empty-state"><div className="empty-state-icon">-</div><h3>No rides yet</h3><p>Accept your first ride from the Available tab.</p></div>
            ) : (
              <div className="rides-grid">
                {myRides.map((ride) => (
                  <div
                    key={ride._id}
                    className="card"
                    onClick={() => {
                      if (['accepted', 'in_progress'].includes(ride.status)) {
                        navigate('/driver/current-ride');
                      }
                    }}
                    style={{
                      cursor: ['accepted', 'in_progress'].includes(ride.status) ? 'pointer' : 'default',
                    }}
                  >
                    <div className="flex-between" style={{ marginBottom: 12 }}>
                      <div><div style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>{ride.userId?.name}</div><div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{new Date(ride.createdAt).toLocaleString()}</div></div>
                      <span className={`badge badge-${ride.status}`}>{ride.status.replace('_', ' ')}</span>
                    </div>
                    <div style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: '12px 14px', marginBottom: 12, fontSize: 13 }}>
                      <div style={{ marginBottom: 4 }}>From: {ride.pickup.address}</div>
                      <div>To: {ride.dropoff.address}</div>
                    </div>
                    <div className="flex-between"><span style={{ color: 'var(--amber)', fontWeight: 700, fontSize: 18 }}>Rs {ride.fare}</span><span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{ride.distance} km{ride.estimatedDuration ? ` | ${ride.estimatedDuration} min` : ''}</span></div>
                    {!!ride.userPriceAddon && <div style={{ marginTop: 8, fontSize: 13, color: 'var(--success)' }}>Rider add-on: +Rs {ride.userPriceAddon}</div>}
                    {ride.rating && <div style={{ marginTop: 10, fontSize: 14, color: 'var(--text-secondary)' }}>Rating: {'*'.repeat(ride.rating)}</div>}
                    {['accepted', 'in_progress'].includes(ride.status) ? (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        style={{ marginTop: 10 }}
                        onClick={() => navigate('/driver/current-ride')}
                      >
                        Open Current Ride
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
