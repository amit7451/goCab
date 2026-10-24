import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import API from '../api/axios';
import RideCard from '../components/RideCard';
import toast from 'react-hot-toast';
import { Ride, RideStatus } from '../types';

type FilterType = 'all' | RideStatus;

const STATUS_FILTERS: FilterType[] = ['all', 'requested', 'accepted', 'in_progress', 'completed', 'cancelled'];

export default function MyRides(): React.ReactElement {
  const [rides, setRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [filter, setFilter] = useState<FilterType>('all');
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [nowMs, setNowMs] = useState<number>(Date.now());

  const fetchRides = useCallback(async (showRefreshing = false): Promise<void> => {
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
    const interval = setInterval(() => {
      fetchRides();
    }, 15000);
    return () => clearInterval(interval);
  }, [fetchRides]);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const filteredRides = rides.filter((r) => filter === 'all' || r.status === filter);

  // Stats
  const total = rides.length;
  const completed = rides.filter((r) => r.status === 'completed').length;
  const totalSpent = rides
    .filter((r) => r.status === 'completed')
    .reduce((acc, r) => acc + (r.fare || 0), 0);
  const active = rides.filter((r) => ['requested', 'accepted', 'in_progress'].includes(r.status)).length;

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
        <p style={{ color: 'var(--text-secondary)' }}>Loading your rides…</p>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="container">
        {/* Header */}
        <div className="flex-between" style={{ marginBottom: 32 }}>
          <div className="page-header" style={{ marginBottom: 0 }}>
            <h1>
              My <span>Rides</span>
            </h1>
            <p>Your complete ride history</p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => fetchRides(true)}
              className="btn btn-ghost btn-sm"
              disabled={refreshing}
            >
              {refreshing ? <div className="spinner" style={{ width: 14, height: 14 }} /> : '↻'} Refresh
            </button>
            <Link to="/book" className="btn btn-primary btn-sm">
              + New Ride
            </Link>
          </div>
        </div>

        {/* Stats */}
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-value">{total}</div>
            <div className="stat-label">Total Rides</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{completed}</div>
            <div className="stat-label">Completed</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ fontSize: 24 }}>
              ₹{totalSpent.toFixed(0)}
            </div>
            <div className="stat-label">Total Spent</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: active > 0 ? 'var(--success)' : 'var(--amber)' }}>
              {active}
            </div>
            <div className="stat-label">Active</div>
          </div>
        </div>

        {/* Active ride alert */}
        {active > 0 && (
          <div
            style={{
              background: 'rgba(16,185,129,0.08)',
              border: '1px solid rgba(16,185,129,0.25)',
              borderRadius: 'var(--radius)',
              padding: '14px 20px',
              marginBottom: 24,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <span style={{ fontSize: 20 }}>🟢</span>
            <span style={{ color: 'var(--success)', fontSize: 14 }}>
              You have <strong>{active}</strong> active ride{active > 1 ? 's' : ''}. Updates refresh
              automatically every 15 seconds.
            </span>
          </div>
        )}

        {/* Filter tabs */}
        <div
          style={{
            display: 'flex',
            gap: 8,
            marginBottom: 24,
            flexWrap: 'wrap',
          }}
        >
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`btn btn-sm ${filter === s ? 'btn-primary' : 'btn-ghost'}`}
            >
              {s === 'all' ? 'All' : s.replace('_', ' ')}
              {s !== 'all' && (
                <span
                  style={{
                    background: filter === s ? 'rgba(0,0,0,0.2)' : 'var(--bg-elevated)',
                    borderRadius: 999,
                    padding: '1px 7px',
                    fontSize: 11,
                  }}
                >
                  {rides.filter((r) => r.status === s).length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Rides list */}
        {filteredRides.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🚕</div>
            <h3>{filter === 'all' ? 'No rides yet' : `No ${filter.replace('_', ' ')} rides`}</h3>
            <p>
              {filter === 'all'
                ? 'Your ride history will appear here once you book your first trip.'
                : 'Switch to "All" to see rides with a different status.'}
            </p>
            {filter === 'all' && (
              <Link to="/book" className="btn btn-primary" style={{ marginTop: 20 }}>
                Book Your First Ride
              </Link>
            )}
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
