import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../api/axios';
import toast from 'react-hot-toast';
import { Ride, RideStatus, RideType } from '../types';

const STATUS_LABELS: Record<RideStatus, string> = {
  requested: 'Waiting for nearby driver',
  accepted: 'Driver on the way',
  in_progress: 'On trip',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const RIDE_TYPE_ICON: Record<RideType, string> = {
  economy: '🚗',
  comfort: '🚙',
  premium: '🏎️',
};

const formatCountdown = (seconds: number): string => {
  const safe = Math.max(0, Number(seconds || 0));
  const mm = String(Math.floor(safe / 60)).padStart(2, '0');
  const ss = String(safe % 60).padStart(2, '0');
  return `${mm}:${ss}`;
};

interface RideCardProps {
  ride: Ride;
  onUpdate?: () => void;
  nowMs?: number;
}

export default function RideCard({ ride, onUpdate, nowMs }: RideCardProps): React.ReactElement {
  const navigate = useNavigate();
  const [boostBy, setBoostBy] = useState<string | number>(20);
  const [actionLoading, setActionLoading] = useState('');

  const canCancel = ride.status === 'requested';
  const canRate = ride.status === 'completed' && !ride.rating;
  const secondsLeft = ride.requestExpiresAt
    ? Math.max(0, Math.floor((new Date(ride.requestExpiresAt).getTime() - (nowMs || Date.now())) / 1000))
    : 0;
  const canBoost = ride.status === 'requested' && secondsLeft > 0;
  const hasLiveTracking = ['requested', 'accepted', 'in_progress'].includes(ride.status);

  const openRideDetails = (): void => {
    navigate(`/current-ride?rideId=${ride._id}`);
  };

  const handleCardClick = (event: React.MouseEvent): void => {
    if ((event.target as HTMLElement).closest('button, input, select, textarea, a')) return;
    openRideDetails();
  };

  const handleCardKeyDown = (event: React.KeyboardEvent): void => {
    if ((event.target as HTMLElement).closest('button, input, select, textarea, a')) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openRideDetails();
    }
  };

  const handleCancel = async (): Promise<void> => {
    if (!window.confirm('Cancel this ride?')) return;
    setActionLoading('cancel');
    try {
      await API.put(`/rides/${ride._id}/cancel`);
      toast.success('Ride cancelled');
      onUpdate?.();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to cancel');
    } finally {
      setActionLoading('');
    }
  };

  const handleRate = async (rating: number): Promise<void> => {
    try {
      await API.put(`/rides/${ride._id}/rate`, { rating });
      toast.success(`Rated ${rating} ⭐`);
      onUpdate?.();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to rate');
    }
  };

  const handleBoost = async (): Promise<void> => {
    const increment = Number(boostBy);
    if (!increment || increment <= 0) {
      toast.error('Enter a valid boost amount');
      return;
    }
    setActionLoading('boost');
    try {
      await API.put(`/rides/${ride._id}/addon`, { incrementBy: increment });
      toast.success(`Fare boosted by ₹${increment}`);
      onUpdate?.();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to boost fare');
    } finally {
      setActionLoading('');
    }
  };

  const rideTypeName = ride.rideType
    ? ride.rideType.charAt(0).toUpperCase() + ride.rideType.slice(1)
    : 'Economy';

  return (
    <div
      className="card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        cursor: hasLiveTracking ? 'pointer' : 'default',
        transition: 'transform 0.15s, border-color 0.15s',
      }}
      onClick={hasLiveTracking ? handleCardClick : undefined}
      onKeyDown={hasLiveTracking ? handleCardKeyDown : undefined}
      tabIndex={hasLiveTracking ? 0 : undefined}
      role={hasLiveTracking ? 'button' : undefined}
    >
      {/* Header */}
      <div className="flex-between">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 24 }}>{RIDE_TYPE_ICON[ride.rideType] || '🚕'}</span>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16 }}>
              {rideTypeName}
            </div>
            <div className="text-small text-muted">{new Date(ride.createdAt).toLocaleString()}</div>
          </div>
        </div>
        <span className={`badge badge-${ride.status}`}>
          {STATUS_LABELS[ride.status] || ride.status}
        </span>
      </div>

      {/* Countdown timer for requested status */}
      {ride.status === 'requested' && secondsLeft > 0 && (
        <div
          style={{
            background: secondsLeft <= 60 ? 'rgba(239,68,68,0.1)' : 'var(--amber-glow)',
            border: `1px solid ${secondsLeft <= 60 ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.25)'}`,
            borderRadius: 8,
            padding: '8px 12px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: 13,
          }}
        >
          <span style={{ color: 'var(--text-secondary)' }}>⏱️ Driver Wait Timeout</span>
          <strong style={{ color: secondsLeft <= 60 ? 'var(--danger)' : 'var(--amber)' }}>
            {formatCountdown(secondsLeft)}
          </strong>
        </div>
      )}

      {/* Route */}
      <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: '14px 16px' }}>
        <div className="ride-stop">
          <span className="ride-stop-dot pickup" />
          <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
            <strong style={{ color: 'var(--text-primary)' }}>Pickup: </strong>
            {ride.pickup.address}
          </span>
        </div>
        <div className="ride-stop-line" style={{ marginLeft: 5, marginTop: 4, marginBottom: 4 }} />
        <div className="ride-stop">
          <span className="ride-stop-dot dropoff" />
          <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
            <strong style={{ color: 'var(--text-primary)' }}>Drop-off: </strong>
            {ride.dropoff.address}
          </span>
        </div>
      </div>

      {/* Info row */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <InfoChip label="Fare" value={`₹${ride.fare}`} highlight />
        <InfoChip label="Distance" value={`${ride.distance} km`} />
        <InfoChip label="Payment" value={ride.paymentMethod} />
        {ride.rating && <InfoChip label="Your Rating" value={`${'⭐'.repeat(ride.rating)}`} />}
      </div>

      {/* OTP Display for accepted rides */}
      {ride.status === 'accepted' && ride.pickupOtp && !ride.pickupOtpVerifiedAt && (
        <div
          style={{
            background: 'rgba(16,185,129,0.1)',
            border: '1px solid rgba(16,185,129,0.3)',
            borderRadius: 8,
            padding: '10px 14px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Pickup OTP for Driver:</span>
          <strong style={{ fontSize: 20, letterSpacing: 4, color: 'var(--success)' }}>
            {ride.pickupOtp}
          </strong>
        </div>
      )}

      {/* Driver info */}
      {ride.driverId && (
        <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: '12px 16px', fontSize: 14 }}>
          <span style={{ color: 'var(--text-secondary)' }}>Driver: </span>
          <strong>{ride.driverId.userId?.name || 'Assigned'}</strong>
          {ride.driverId.vehicleInfo && (
            <span style={{ color: 'var(--text-secondary)', marginLeft: 8 }}>
              · {ride.driverId.vehicleInfo.color} {ride.driverId.vehicleInfo.make} {ride.driverId.vehicleInfo.model}
            </span>
          )}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {hasLiveTracking && (
          <button
            type="button"
            onClick={openRideDetails}
            className="btn btn-primary btn-sm"
          >
            🗺️ Live Tracking
          </button>
        )}

        {canCancel && (
          <button
            type="button"
            onClick={handleCancel}
            className="btn btn-danger btn-sm"
            disabled={actionLoading === 'cancel'}
          >
            {actionLoading === 'cancel' ? 'Cancelling…' : 'Cancel Ride'}
          </button>
        )}

        {canBoost && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="number"
              className="form-input"
              value={boostBy}
              min={10}
              step={10}
              onChange={(e) => setBoostBy(e.target.value)}
              style={{ width: 80, padding: '6px 8px', fontSize: 13 }}
            />
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleBoost}
              disabled={actionLoading === 'boost'}
            >
              {actionLoading === 'boost' ? 'Boosting…' : '+ Boost Fare'}
            </button>
          </div>
        )}

        {canRate && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Rate:</span>
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                onClick={() => handleRate(star)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 22,
                  padding: '0 2px',
                  transition: 'transform 0.15s',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.transform = 'scale(1.3)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
                }}
              >
                ⭐
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface InfoChipProps {
  label: string;
  value: string | number;
  highlight?: boolean;
}

function InfoChip({ label, value, highlight }: InfoChipProps): React.ReactElement {
  return (
    <div
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '6px 12px',
        fontSize: 13,
      }}
    >
      <span style={{ color: 'var(--text-muted)' }}>{label}: </span>
      <strong style={{ color: highlight ? 'var(--amber)' : 'var(--text-primary)' }}>{value}</strong>
    </div>
  );
}
