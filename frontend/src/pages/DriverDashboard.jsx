import { useState, useEffect, useCallback } from 'react';
import API from '../api/axios';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';

const STATUS_LABEL = {
  accepted: 'Pick Up Passenger',
  in_progress: 'Complete Ride',
};

export default function DriverDashboard() {
  const { user } = useAuth();

  const [profile, setProfile] = useState(null);
  const [availableRides, setAvailableRides] = useState([]);
  const [myRides, setMyRides] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('available');
  const [actionLoading, setActionLoading] = useState('');

  const fetchAll = useCallback(async () => {
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
    const interval = setInterval(fetchAll, 12000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  const toggleAvailability = async () => {
    try {
      const res = await API.put('/driver/availability', { isAvailable: !profile.isAvailable });
      setProfile(res.data.driver);
      toast.success(res.data.message);
    } catch (err) {
      toast.error('Failed to update availability');
    }
  };

  const acceptRide = async (rideId) => {
    setActionLoading(rideId);
    try {
      await API.put(`/driver/accept-ride/${rideId}`);
      toast.success('Ride accepted! Head to pickup location.');
      await fetchAll();
      setTab('my-rides');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to accept ride');
    } finally {
      setActionLoading('');
    }
  };

  const updateRideStatus = async (rideId, currentStatus) => {
    const nextStatus = currentStatus === 'accepted' ? 'in_progress' : 'completed';
    setActionLoading(rideId);
    try {
      await API.put(`/driver/update-ride/${rideId}`, { status: nextStatus });
      toast.success(nextStatus === 'completed' ? '✅ Ride completed!' : '🚗 Ride started!');
      await fetchAll();
    } catch (err) {
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
  const completedRides = myRides.filter((r) => r.status === 'completed');

  return (
    <div className="page">
      <div className="container">
        {/* Header */}
        <div className="flex-between" style={{ marginBottom: 32 }}>
          <div className="page-header" style={{ marginBottom: 0 }}>
            <h1>Driver <span>Dashboard</span></h1>
            <p>Welcome back, {user?.name?.split(' ')[0]}</p>
          </div>
          {/* Online/Offline toggle */}
          {profile && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 10, height: 10, borderRadius: '50%',
                background: profile.isAvailable ? 'var(--success)' : 'var(--text-muted)',
                boxShadow: profile.isAvailable ? '0 0 8px var(--success)' : 'none',
                transition: 'all 0.3s',
              }} />
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
            <div className="stat-value" style={{ fontSize: 24 }}>₹{(profile?.earnings || 0).toFixed(0)}</div>
            <div className="stat-label">Total Earnings</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">
              {profile?.rating?.count > 0 ? profile.rating.average : '—'}
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
          <div className="card" style={{ marginBottom: 24, display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 40 }}>🚗</span>
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 18 }}>
                {profile.vehicleInfo.color} {profile.vehicleInfo.make} {profile.vehicleInfo.model} ({profile.vehicleInfo.year})
              </div>
              <div style={{ color: 'var(--text-secondary)', fontSize: 14, marginTop: 4 }}>
                <span style={{ color: 'var(--amber)', fontWeight: 600 }}>{profile.vehicleInfo.licensePlate}</span>
                &nbsp;·&nbsp;License: {profile.licenseNumber}
              </div>
            </div>
          </div>
        )}

        {/* Active ride banner */}
        {activeRide && (
          <div style={{
            background: 'rgba(245,158,11,0.08)',
            border: '1.5px solid rgba(245,158,11,0.3)',
            borderRadius: 'var(--radius)',
            padding: '16px 20px',
            marginBottom: 24,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <div style={{ color: 'var(--amber)', fontWeight: 700, fontFamily: 'var(--font-display)', marginBottom: 6 }}>
                  🟡 Active Ride
                </div>
                <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
                  Passenger: <strong style={{ color: 'var(--text-primary)' }}>{activeRide.userId?.name}</strong>
                  &nbsp;({activeRide.userId?.phone})
                </div>
                <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 4 }}>
                  📍 {activeRide.pickup.address} → {activeRide.dropoff.address}
                </div>
                <div style={{ fontSize: 14, marginTop: 4 }}>
                  Fare: <strong style={{ color: 'var(--amber)' }}>₹{activeRide.fare}</strong>
                  &nbsp;·&nbsp; Status: <span className={`badge badge-${activeRide.status}`}>{activeRide.status.replace('_', ' ')}</span>
                </div>
              </div>
              <button
                onClick={() => updateRideStatus(activeRide._id, activeRide.status)}
                className="btn btn-primary"
                disabled={actionLoading === activeRide._id}
              >
                {actionLoading === activeRide._id
                  ? <><div className="spinner" style={{ width: 16, height: 16 }} /> Updating…</>
                  : STATUS_LABEL[activeRide.status]}
              </button>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 24, borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
          {[
            { id: 'available', label: `Available (${availableRides.length})` },
            { id: 'my-rides', label: `My Rides (${myRides.length})` },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`btn btn-sm ${tab === t.id ? 'btn-primary' : 'btn-ghost'}`}
            >
              {t.label}
            </button>
          ))}
          <button
            onClick={fetchAll}
            className="btn btn-ghost btn-sm"
            style={{ marginLeft: 'auto' }}
          >
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
                {availableRides.map((ride) => (
                  <div key={ride._id} className="card">
                    <div className="flex-between" style={{ marginBottom: 12 }}>
                      <div>
                        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700 }}>
                          {ride.userId?.name}
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                          {ride.userId?.phone}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ color: 'var(--amber)', fontWeight: 800, fontSize: 20 }}>
                          ₹{ride.fare}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{ride.distance} km</div>
                      </div>
                    </div>

                    <div style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: '12px 14px', marginBottom: 12, fontSize: 13 }}>
                      <div style={{ marginBottom: 6 }}>
                        <span style={{ color: 'var(--text-muted)' }}>From: </span>
                        <strong>{ride.pickup.address}</strong>
                      </div>
                      <div>
                        <span style={{ color: 'var(--text-muted)' }}>To: </span>
                        <strong>{ride.dropoff.address}</strong>
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <span style={{
                          background: 'var(--bg-elevated)',
                          border: '1px solid var(--border)',
                          borderRadius: 6, padding: '4px 10px', fontSize: 12
                        }}>
                          {ride.rideType}
                        </span>
                        <span style={{
                          background: 'var(--bg-elevated)',
                          border: '1px solid var(--border)',
                          borderRadius: 6, padding: '4px 10px', fontSize: 12
                        }}>
                          {ride.paymentMethod}
                        </span>
                      </div>
                      <button
                        onClick={() => acceptRide(ride._id)}
                        className="btn btn-primary btn-sm"
                        disabled={!!actionLoading || !profile?.isAvailable}
                      >
                        {actionLoading === ride._id
                          ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Accepting…</>
                          : 'Accept Ride'}
                      </button>
                    </div>

                    {!profile?.isAvailable && (
                      <div style={{ marginTop: 10, fontSize: 12, color: 'var(--danger)', textAlign: 'center' }}>
                        Go online to accept rides
                      </div>
                    )}
                  </div>
                ))}
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
                          {ride.userId?.name}
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                          {new Date(ride.createdAt).toLocaleString()}
                        </div>
                      </div>
                      <span className={`badge badge-${ride.status}`}>
                        {ride.status.replace('_', ' ')}
                      </span>
                    </div>

                    <div style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: '12px 14px', marginBottom: 12, fontSize: 13 }}>
                      <div style={{ marginBottom: 4 }}>📍 {ride.pickup.address}</div>
                      <div>🏁 {ride.dropoff.address}</div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
