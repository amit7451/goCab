import { useState } from 'react';
import API from '../api/axios';
import toast from 'react-hot-toast';

const STATUS_LABELS = {
  requested: 'Waiting for nearby driver',
  accepted: 'Driver on the way',
  in_progress: 'On trip',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const RIDE_TYPE_ICON = { economy: 'CAR', comfort: 'SUV', premium: 'LUX' };

const formatCountdown = (seconds) => {
  const safe = Math.max(0, Number(seconds || 0));
  const mm = String(Math.floor(safe / 60)).padStart(2, '0');
  const ss = String(safe % 60).padStart(2, '0');
  return `${mm}:${ss}`;
};

export default function RideCard({ ride, onUpdate, nowMs }) {
  const [boostBy, setBoostBy] = useState(20);
  const canCancel = ['requested', 'accepted'].includes(ride.status);
  const canRate = ride.status === 'completed' && !ride.rating;
  const secondsLeft = ride.requestExpiresAt
    ? Math.max(0, Math.floor((new Date(ride.requestExpiresAt).getTime() - (nowMs || Date.now())) / 1000))
    : 0;
  const canBoost = ride.status === 'requested' && secondsLeft > 0;

  const handleCancel = async () => {
    if (!confirm('Cancel this ride?')) return;
    try {
      await API.put(`/rides/${ride._id}/cancel`);
      toast.success('Ride cancelled');
      onUpdate?.();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to cancel');
    }
  };

  const handleRate = async (rating) => {
    try {
      await API.put(`/rides/${ride._id}/rate`, { rating });
      toast.success(`Rated ${rating} stars`);
      onUpdate?.();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to rate');
    }
  };

  const handleBoost = async () => {
    const incrementBy = Math.max(10, Number(boostBy || 0));
    try {
      await API.put(`/rides/${ride._id}/addon`, { incrementBy });
      toast.success(`Fare increased by Rs ${incrementBy}`);
      onUpdate?.();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update fare');
    }
  };

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="flex-between">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>{RIDE_TYPE_ICON[ride.rideType] || 'RIDE'}</span>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16 }}>
              {ride.rideType.charAt(0).toUpperCase() + ride.rideType.slice(1)}
            </div>
            <div className="text-small text-muted">{new Date(ride.createdAt).toLocaleString()}</div>
          </div>
        </div>
        <span className={`badge badge-${ride.status}`}>{STATUS_LABELS[ride.status] || ride.status}</span>
      </div>

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

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <InfoChip label="Fare" value={`Rs ${ride.fare}`} highlight />
        <InfoChip label="Distance" value={`${ride.distance} km`} />
        <InfoChip label="ETA" value={`${ride.estimatedDuration || 0} min`} />
        {ride.userPriceAddon ? <InfoChip label="Add-on" value={`+Rs ${ride.userPriceAddon}`} /> : null}
        {ride.rating ? <InfoChip label="Your Rating" value={`${'*'.repeat(ride.rating)}`} /> : null}
      </div>

      {ride.status === 'requested' && (
        <div style={{ fontSize: 13, color: secondsLeft <= 45 ? 'var(--danger)' : 'var(--amber)' }}>
          Driver wait timer: {formatCountdown(secondsLeft)}
        </div>
      )}

      {ride.status === 'accepted' && ride.pickupOtp && !ride.pickupOtpVerifiedAt ? (
        <div
          style={{
            background: 'rgba(16,185,129,0.12)',
            border: '1px solid rgba(16,185,129,0.35)',
            borderRadius: 10,
            padding: '12px 14px',
          }}
        >
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
            Share this pickup OTP with your driver
          </div>
          <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: 6, color: 'var(--success)' }}>
            {ride.pickupOtp}
          </div>
        </div>
      ) : null}

      {ride.status === 'accepted' && ride.pickupOtpVerifiedAt ? (
        <div style={{ fontSize: 13, color: 'var(--success)' }}>
          Pickup OTP verified at {new Date(ride.pickupOtpVerifiedAt).toLocaleTimeString()}
        </div>
      ) : null}

      {ride.cancelledReason ? (
        <div style={{ fontSize: 13, color: 'var(--danger)' }}>Reason: {ride.cancelledReason}</div>
      ) : null}

      {ride.driverId && (
        <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: '12px 16px', fontSize: 14 }}>
          <span style={{ color: 'var(--text-secondary)' }}>Driver: </span>
          <strong>{ride.driverId?.userId?.name || 'Assigned'}</strong>
          {ride.driverId?.vehicleInfo ? (
            <span style={{ color: 'var(--text-secondary)', marginLeft: 8 }}>
              | {ride.driverId.vehicleInfo.color} {ride.driverId.vehicleInfo.make} {ride.driverId.vehicleInfo.model}
            </span>
          ) : null}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {canCancel ? (
          <button onClick={handleCancel} className="btn btn-danger btn-sm">
            Cancel Ride
          </button>
        ) : null}

        {canBoost ? (
          <>
            <input
              className="form-input"
              type="number"
              min={10}
              step={10}
              value={boostBy}
              onChange={(e) => setBoostBy(e.target.value)}
              style={{ width: 110, padding: '8px 10px' }}
            />
            <button onClick={handleBoost} className="btn btn-secondary btn-sm">
              Increase Fare
            </button>
          </>
        ) : null}

        {canRate ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Rate:</span>
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                onClick={() => handleRate(star)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18 }}
              >
                *
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function InfoChip({ label, value, highlight }) {
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
