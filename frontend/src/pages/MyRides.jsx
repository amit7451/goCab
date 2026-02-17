import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import API from '../api/axios';
import RideCard from '../components/RideCard';
import toast from 'react-hot-toast';

const STATUS_FILTERS = ['all', 'requested', 'accepted', 'in_progress', 'completed', 'cancelled'];

export default function MyRides() {
  const [rides, setRides] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [refreshing, setRefreshing] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());
  const lastUserLocationSyncRef = useRef(0);

  const fetchRides = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true);
    try {
      const res = await API.get('/rides/my-rides');
      setRides(res.data.rides || []);
    } catch (err) {
      toast.error('Failed to load rides');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchRides();
    const interval = setInterval(() => fetchRides(), 8000);
    return () => clearInterval(interval);
  }, [fetchRides]);

  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const activeRides = useMemo(
    () => rides.filter((r) => ['requested', 'accepted', 'in_progress'].includes(r.status)),
    [rides]
  );

  useEffect(() => {
    if (!activeRides.length || !navigator.geolocation) return;

    const watchId = navigator.geolocation.watchPosition(
      async (position) => {
        const now = Date.now();
        if (now - lastUserLocationSyncRef.current < 12000) return;
        lastUserLocationSyncRef.current = now;

        const payload = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          address: '',
        };

        await Promise.all(
          activeRides.map((ride) =>
            API.put(`/rides/${ride._id}/user-location`, payload).catch(() => null)
          )
        );
      },
      () => {},
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 7000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [activeRides]);

  const filteredRides = rides.filter((r) => filter === 'all' || r.status === filter);

  const total = rides.length;
  const completed = rides.filter((r) => r.status === 'completed').length;
  const totalSpent = rides.filter((r) => r.status === 'completed').reduce((acc, r) => acc + r.fare, 0);
  const active = activeRides.length;

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
        <p style={{ color: 'var(--text-secondary)' }}>Loading your rides...</p>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="container">
        <div className="flex-between" style={{ marginBottom: 32 }}>
          <div className="page-header" style={{ marginBottom: 0 }}>
            <h1>My <span>Rides</span></h1>
            <p>Your complete ride history</p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => fetchRides(true)} className="btn btn-ghost btn-sm" disabled={refreshing}>
              {refreshing ? '...' : 'Refresh'}
            </button>
            <Link to="/book" className="btn btn-primary btn-sm">+ New Ride</Link>
          </div>
        </div>

        <div className="stats-grid">
          <div className="stat-card"><div className="stat-value">{total}</div><div className="stat-label">Total Rides</div></div>
          <div className="stat-card"><div className="stat-value">{completed}</div><div className="stat-label">Completed</div></div>
          <div className="stat-card"><div className="stat-value" style={{ fontSize: 24 }}>Rs {totalSpent.toFixed(0)}</div><div className="stat-label">Total Spent</div></div>
          <div className="stat-card"><div className="stat-value" style={{ color: active > 0 ? 'var(--success)' : 'var(--amber)' }}>{active}</div><div className="stat-label">Active</div></div>
        </div>

        {active > 0 && (
          <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 'var(--radius)', padding: '14px 20px', marginBottom: 24 }}>
            <span style={{ color: 'var(--success)', fontSize: 14 }}>
              Active ride updates are synced every few seconds. Waiting rides auto-cancel after 5 minutes.
            </span>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
          {STATUS_FILTERS.map((s) => (
            <button key={s} onClick={() => setFilter(s)} className={`btn btn-sm ${filter === s ? 'btn-primary' : 'btn-ghost'}`}>
              {s === 'all' ? 'All' : s.replace('_', ' ')}
            </button>
          ))}
        </div>

        {filteredRides.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">RIDE</div>
            <h3>{filter === 'all' ? 'No rides yet' : `No ${filter.replace('_', ' ')} rides`}</h3>
            <p>{filter === 'all' ? 'Your ride history will appear here once you book your first trip.' : 'Switch to All to see other rides.'}</p>
            {filter === 'all' ? <Link to="/book" className="btn btn-primary" style={{ marginTop: 20 }}>Book Your First Ride</Link> : null}
          </div>
        ) : (
          <div className="rides-grid">
            {filteredRides.map((ride) => (
              <RideCard key={ride._id} ride={ride} nowMs={nowMs} onUpdate={() => fetchRides()} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
