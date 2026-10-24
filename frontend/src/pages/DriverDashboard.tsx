import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../api/axios';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { DriverProfile, Ride, RideStatus } from '../types';
import { connectSocket, sendDriverLocation } from '../utils/socket';

const STATUS_LABEL: Record<string, string> = {
  accepted: 'Pick Up Passenger',
  in_progress: 'Complete Ride',
};

type DashboardTab = 'available' | 'my-rides';

const formatCountdown = (seconds: number): string => {
  const safe = Math.max(0, Number(seconds || 0));
  const mm = String(Math.floor(safe / 60)).padStart(2, '0');
  const ss = String(safe % 60).padStart(2, '0');
  return `${mm}:${ss}`;
};

export default function DriverDashboard(): React.ReactElement {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [availableRides, setAvailableRides] = useState<Ride[]>([]);
  const [myRides, setMyRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [tab, setTab] = useState<DashboardTab>('available');
  const [actionLoading, setActionLoading] = useState<string>('');
  const [nowMs, setNowMs] = useState<number>(Date.now());
  const [isLiveConnected, setIsLiveConnected] = useState<boolean>(false);
  const [driverCoords, setDriverCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [isGpsActive, setIsGpsActive] = useState<boolean>(false);

  const watchIdRef = useRef<number | null>(null);
  const lastLocationSyncRef = useRef<number>(0);

  const fetchAll = useCallback(async (): Promise<void> => {
    try {
      const [profileRes, availRes, myRidesRes] = await Promise.all([
        API.get('/driver/profile'),
        API.get('/driver/available-rides'),
        API.get('/driver/my-rides'),
      ]);
      setProfile(profileRes.data.driver);
      setAvailableRides(availRes.data.rides || []);
      setMyRides(myRidesRes.data.rides || []);
    } catch (err) {
      toast.error('Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 6000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  useEffect(() => {
    const socket = connectSocket();
    setIsLiveConnected(socket.connected);

    const onConnect = () => setIsLiveConnected(true);
    const onDisconnect = () => setIsLiveConnected(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    const onNewOffer = () => {
      toast.success('🚗 New ride request available!');
      fetchAll();
    };

    const onPriceBoosted = () => {
      fetchAll();
    };

    const onRideCancelled = () => {
      fetchAll();
    };

    socket.on('ride:new_offer', onNewOffer);
    socket.on('ride:price_boosted', onPriceBoosted);
    socket.on('ride:cancelled', onRideCancelled);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('ride:new_offer', onNewOffer);
      socket.off('ride:price_boosted', onPriceBoosted);
      socket.off('ride:cancelled', onRideCancelled);
    };
  }, [fetchAll]);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Continuous GPS watch and location synchronization
  useEffect(() => {
    if (!navigator.geolocation || !profile?.isAvailable) {
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      setIsGpsActive(false);
      return;
    }

    const onPosition = (position: GeolocationPosition) => {
      const coords = { lat: position.coords.latitude, lng: position.coords.longitude };
      setDriverCoords(coords);
      setIsGpsActive(true);

      // Broadcast immediately via socket to backend & any active trip
      sendDriverLocation(undefined, coords);

      // Throttle DB update to every 10 seconds
      const now = Date.now();
      if (now - lastLocationSyncRef.current >= 10000) {
        lastLocationSyncRef.current = now;
        API.put('/driver/location', { lat: coords.lat, lng: coords.lng }).catch(() => null);
      }
    };

    const onError = () => {
      setIsGpsActive(false);
    };

    navigator.geolocation.getCurrentPosition(onPosition, onError, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 8000,
    });

    watchIdRef.current = navigator.geolocation.watchPosition(onPosition, onError, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 8000,
    });

    return () => {
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [profile?.isAvailable]);

  const toggleAvailability = async (): Promise<void> => {
    if (!profile) return;
    try {
      const res = await API.put('/driver/availability', { isAvailable: !profile.isAvailable });
      setProfile(res.data.driver);
      toast.success(res.data.message);
      await fetchAll();
    } catch (err) {
      toast.error('Failed to update availability');
    }
  };

  const acceptRide = async (rideId: string): Promise<void> => {
    setActionLoading(rideId);
    try {
      await API.put(`/driver/accept-ride/${rideId}`);
      if (driverCoords) {
        sendDriverLocation(rideId, driverCoords);
      }
      toast.success('Ride accepted! Heading to trip navigation…');
      await fetchAll();
      navigate('/driver/current-ride');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to accept ride');
    } finally {
      setActionLoading('');
    }
  };

  const updateRideStatus = async (rideId: string, currentStatus: RideStatus): Promise<void> => {
    const nextStatus = currentStatus === 'accepted' ? 'in_progress' : 'completed';
    setActionLoading(rideId);
    try {
      await API.put(`/driver/update-ride/${rideId}`, { status: nextStatus });
      toast.success(nextStatus === 'completed' ? '✅ Ride completed!' : '🚗 Ride started!');
      await fetchAll();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to update ride');
    } finally {
      setActionLoading('');
    }
  };

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
        <p style={{ color: 'var(--text-secondary)' }}>Loading dashboard…</p>
      </div>
    );
  }

  const activeRide = myRides.find((r) => ['accepted', 'in_progress'].includes(r.status));

  return (
    <div className="page">
      <div className="container">
        {/* Header */}
        <div className="flex-between" style={{ marginBottom: 32 }}>
          <div className="page-header" style={{ marginBottom: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <h1 style={{ margin: 0 }}>
                Driver <span>Dashboard</span>
              </h1>
              <span
                style={{
                  fontSize: 11,
                  padding: '3px 8px',
                  borderRadius: 20,
                  fontWeight: 600,
                  background: isLiveConnected ? 'rgba(34, 197, 94, 0.15)' : 'rgba(234, 179, 8, 0.15)',
                  color: isLiveConnected ? '#22c55e' : '#eab308',
                  border: `1px solid ${isLiveConnected ? 'rgba(34, 197, 94, 0.3)' : 'rgba(234, 179, 8, 0.3)'}`,
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
                    background: isLiveConnected ? '#22c55e' : '#eab308',
                  }}
                />
                {isLiveConnected ? 'Live Real-Time' : 'Polling'}
              </span>
              <span
                style={{
                  fontSize: 11,
                  padding: '3px 8px',
                  borderRadius: 20,
                  fontWeight: 600,
                  background: isGpsActive ? 'rgba(34, 197, 94, 0.15)' : 'rgba(148, 163, 184, 0.15)',
                  color: isGpsActive ? '#22c55e' : '#94a3b8',
                  border: `1px solid ${isGpsActive ? 'rgba(34, 197, 94, 0.3)' : 'rgba(148, 163, 184, 0.3)'}`,
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
                    background: isGpsActive ? '#22c55e' : '#94a3b8',
                  }}
                />
                {isGpsActive ? 'GPS Active' : 'GPS Offline'}
              </span>
            </div>
            <p style={{ marginTop: 4 }}>Welcome back, {user?.name?.split(' ')[0]}</p>
          </div>
          {/* Online/Offline toggle */}
          {profile && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: profile.isAvailable ? 'var(--success)' : 'var(--text-muted)',
                  boxShadow: profile.isAvailable ? '0 0 8px var(--success)' : 'none',
                  transition: 'all 0.3s',
                }}
              />
              <span style={{ fontSize: 14, color: 'var(--text-secondary)', fontWeight: 500 }}>
                {profile.isAvailable ? 'Online' : 'Offline'}
              </span>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={profile.isAvailable}
                  onChange={toggleAvailability}
                />
                <span className="toggle-slider" />
              </label>
            </div>
          )}
        </div>

        {/* Stats */}
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-value">{profile?.totalRides || 0}</div>
            <div className="stat-label">Total Rides</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ fontSize: 24 }}>
              ₹{(profile?.earnings || 0).toFixed(0)}
            </div>
            <div className="stat-label">Total Earnings</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">
              {profile?.rating && profile.rating.count > 0 ? profile.rating.average : '—'}
            </div>
            <div className="stat-label">Avg Rating</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{availableRides.length}</div>
            <div className="stat-label">Pending Rides</div>
          </div>
        </div>

        {/* Vehicle info card */}
        {profile?.vehicleInfo && (
          <div
            className="card"
            style={{
              marginBottom: 24,
              display: 'flex',
              gap: 20,
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontSize: 40 }}>🚗</span>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18 }}>
                {profile.vehicleInfo.color} {profile.vehicleInfo.make} {profile.vehicleInfo.model} (
                {profile.vehicleInfo.year})
              </div>
              <div style={{ color: 'var(--text-secondary)', fontSize: 14, marginTop: 4 }}>
                <span style={{ color: 'var(--amber)', fontWeight: 600 }}>
                  {profile.vehicleInfo.licensePlate}
                </span>
                &nbsp;·&nbsp;License: {profile.licenseNumber}
                {profile.vehicleInfo.categories && (
                  <span style={{ marginLeft: 10 }}>
                    · Categories: {profile.vehicleInfo.categories.join(', ')}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Active ride banner */}
        {activeRide && (
          <div
            style={{
              background: 'rgba(245,158,11,0.08)',
              border: '1.5px solid rgba(245,158,11,0.3)',
              borderRadius: 'var(--radius)',
              padding: '16px 20px',
              marginBottom: 24,
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 12,
              }}
            >
              <div>
                <div
                  style={{
                    color: 'var(--amber)',
                    fontWeight: 700,
                    fontFamily: 'var(--font-display)',
                    marginBottom: 6,
                  }}
                >
                  🟡 Active Trip
                </div>
                <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
                  Passenger:{' '}
                  <strong style={{ color: 'var(--text-primary)' }}>
                    {typeof activeRide.userId === 'object' ? activeRide.userId?.name : 'Passenger'}
                  </strong>
                  &nbsp;(
                  {typeof activeRide.userId === 'object' ? activeRide.userId?.phone : 'No phone'}
                  )
                </div>
                <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 4 }}>
                  📍 {activeRide.pickup.address} → {activeRide.dropoff.address}
                </div>
                <div style={{ fontSize: 14, marginTop: 4 }}>
                  Fare: <strong style={{ color: 'var(--amber)' }}>₹{activeRide.fare}</strong>
                  &nbsp;·&nbsp; Status:{' '}
                  <span className={`badge badge-${activeRide.status}`}>
                    {activeRide.status.replace('_', ' ')}
                  </span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => navigate('/driver/current-ride')}
                  className="btn btn-primary"
                >
                  🗺️ Open Live Navigation
                </button>
                <button
                  onClick={() => updateRideStatus(activeRide._id, activeRide.status)}
                  className="btn btn-secondary"
                  disabled={actionLoading === activeRide._id}
                >
                  {actionLoading === activeRide._id ? (
                    <>
                      <div className="spinner" style={{ width: 16, height: 16 }} /> Updating…
                    </>
                  ) : (
                    STATUS_LABEL[activeRide.status] || 'Update Ride'
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div
          style={{
            display: 'flex',
            gap: 8,
            marginBottom: 24,
            borderBottom: '1px solid var(--border)',
            paddingBottom: 12,
          }}
        >
          {[
            { id: 'available', label: `Available (${availableRides.length})` },
            { id: 'my-rides', label: `My Rides (${myRides.length})` },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id as DashboardTab)}
              className={`btn btn-sm ${tab === t.id ? 'btn-primary' : 'btn-ghost'}`}
            >
              {t.label}
            </button>
          ))}
          <button onClick={fetchAll} className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }}>
            ↻ Refresh
          </button>
        </div>

        {/* Available rides tab */}
        {tab === 'available' && (
          <>
            {availableRides.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">🔍</div>
                <h3>No rides available right now</h3>
                <p>New ride requests will appear here automatically. Make sure you're online.</p>
              </div>
            ) : (
              <div className="rides-grid">
                {availableRides.map((ride) => {
                  const secondsLeft = ride.requestExpiresAt
                    ? Math.max(0, Math.floor((new Date(ride.requestExpiresAt).getTime() - nowMs) / 1000))
                    : 0;

                  return (
                    <div key={ride._id} className="card">
                      <div className="flex-between" style={{ marginBottom: 12 }}>
                        <div>
                          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>
                            {typeof ride.userId === 'object' ? ride.userId?.name : 'Passenger'}
                          </div>
                          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                            {typeof ride.userId === 'object' ? ride.userId?.phone : ''}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ color: 'var(--amber)', fontWeight: 800, fontSize: 20 }}>
                            ₹{ride.fare}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            {ride.distance} km
                          </div>
                        </div>
                      </div>

                      {/* Expiry countdown */}
                      {secondsLeft > 0 && (
                        <div
                          style={{
                            background: secondsLeft <= 60 ? 'rgba(239,68,68,0.1)' : 'var(--amber-glow)',
                            borderRadius: 6,
                            padding: '4px 10px',
                            marginBottom: 10,
                            display: 'flex',
                            justifyContent: 'space-between',
                            fontSize: 12,
                          }}
                        >
                          <span style={{ color: 'var(--text-muted)' }}>Auto-expires in:</span>
                          <strong style={{ color: secondsLeft <= 60 ? 'var(--danger)' : 'var(--amber)' }}>
                            {formatCountdown(secondsLeft)}
                          </strong>
                        </div>
                      )}

                      <div
                        style={{
                          background: 'var(--bg-elevated)',
                          borderRadius: 8,
                          padding: '12px 14px',
                          marginBottom: 12,
                          fontSize: 13,
                        }}
                      >
                        <div style={{ marginBottom: 6 }}>
                          <span style={{ color: 'var(--text-muted)' }}>From: </span>
                          <strong>{ride.pickup.address}</strong>
                        </div>
                        <div>
                          <span style={{ color: 'var(--text-muted)' }}>To: </span>
                          <strong>{ride.dropoff.address}</strong>
                        </div>
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          gap: 8,
                        }}
                      >
                        <div style={{ display: 'flex', gap: 6 }}>
                          <span
                            style={{
                              background: 'var(--bg-elevated)',
                              border: '1px solid var(--border)',
                              borderRadius: 6,
                              padding: '4px 8px',
                              fontSize: 11,
                              textTransform: 'uppercase',
                              fontWeight: 600,
                            }}
                          >
                            {ride.rideType}
                          </span>
                          <span
                            style={{
                              background: 'var(--bg-elevated)',
                              border: '1px solid var(--border)',
                              borderRadius: 6,
                              padding: '4px 8px',
                              fontSize: 11,
                              textTransform: 'uppercase',
                              fontWeight: 600,
                            }}
                          >
                            {ride.paymentMethod}
                          </span>
                          {ride.pickupDistanceKm != null ? (
                            <span
                              style={{
                                background: 'rgba(56, 189, 248, 0.12)',
                                color: '#38bdf8',
                                border: '1px solid rgba(56, 189, 248, 0.3)',
                                borderRadius: 6,
                                padding: '4px 8px',
                                fontSize: 11,
                                fontWeight: 700,
                              }}
                            >
                              📍 {ride.pickupDistanceKm} km away
                            </span>
                          ) : null}
                          {ride.userPriceAddon && ride.userPriceAddon > 0 ? (
                            <span
                              style={{
                                background: 'var(--amber-glow)',
                                color: 'var(--amber)',
                                border: '1px solid rgba(245,158,11,0.3)',
                                borderRadius: 6,
                                padding: '4px 8px',
                                fontSize: 11,
                                fontWeight: 700,
                              }}
                            >
                              +₹{ride.userPriceAddon} Boost
                            </span>
                          ) : null}
                        </div>
                        <button
                          onClick={() => acceptRide(ride._id)}
                          className="btn btn-primary btn-sm"
                          disabled={!!actionLoading || !profile?.isAvailable}
                        >
                          {actionLoading === ride._id ? (
                            <>
                              <div className="spinner" style={{ width: 14, height: 14 }} /> Accepting…
                            </>
                          ) : (
                            'Accept Ride'
                          )}
                        </button>
                      </div>

                      {!profile?.isAvailable && (
                        <div
                          style={{
                            marginTop: 10,
                            fontSize: 12,
                            color: 'var(--danger)',
                            textAlign: 'center',
                          }}
                        >
                          Go online to accept rides
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* My rides tab */}
        {tab === 'my-rides' && (
          <>
            {myRides.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">📋</div>
                <h3>No rides yet</h3>
                <p>Accept your first ride from the Available tab.</p>
              </div>
            ) : (
              <div className="rides-grid">
                {myRides.map((ride) => (
                  <div key={ride._id} className="card">
                    <div className="flex-between" style={{ marginBottom: 12 }}>
                      <div>
                        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>
                          {typeof ride.userId === 'object' ? ride.userId?.name : 'Passenger'}
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                          {new Date(ride.createdAt).toLocaleString()}
                        </div>
                      </div>
                      <span className={`badge badge-${ride.status}`}>
                        {ride.status.replace('_', ' ')}
                      </span>
                    </div>

                    <div
                      style={{
                        background: 'var(--bg-elevated)',
                        borderRadius: 8,
                        padding: '12px 14px',
                        marginBottom: 12,
                        fontSize: 13,
                      }}
                    >
                      <div style={{ marginBottom: 4 }}>📍 {ride.pickup.address}</div>
                      <div>🏁 {ride.dropoff.address}</div>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <span style={{ color: 'var(--amber)', fontWeight: 700, fontSize: 18 }}>
                        ₹{ride.fare}
                      </span>
                      {ride.rating && (
                        <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
                          Rating: {'⭐'.repeat(ride.rating)}
                        </span>
                      )}
                    </div>
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
