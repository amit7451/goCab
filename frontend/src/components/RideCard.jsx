import API from '../api/axios';
import toast from 'react-hot-toast';

const STATUS_LABELS = {
  requested: 'Looking for driver…',
  accepted: 'Driver on the way',
  in_progress: 'On trip',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const RIDE_TYPE_ICON = { economy: '🚗', comfort: '🚙', premium: '🏎️' };

export default function RideCard({ ride, onUpdate }) {
  const canCancel = ['requested', 'accepted'].includes(ride.status);
  const canRate = ride.status === 'completed' && !ride.rating;

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
      toast.success(`Rated ${rating} ⭐`);
      onUpdate?.();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to rate');
    }
  };

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div className="flex-between">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 24 }}>{RIDE_TYPE_ICON[ride.rideType] || '🚕'}</span>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16 }}>
              {ride.rideType.charAt(0).toUpperCase() + ride.rideType.slice(1)}
            </div>
            <div className="text-small text-muted">{new Date(ride.createdAt).toLocaleString()}</div>
          </div>
        </div>
        <span className={`badge badge-${ride.status}`}>
          {STATUS_LABELS[ride.status] || ride.status}
        </span>
      </div>

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

      {/* Driver info */}
      {ride.driverId && (
        <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: '12px 16px', fontSize: 14 }}>
          <span style={{ color: 'var(--text-secondary)' }}>Driver: </span>
          <strong>{ride.driverId?.userId?.name || 'Assigned'}</strong>
          {ride.driverId?.vehicleInfo && (
            <span style={{ color: 'var(--text-secondary)', marginLeft: 8 }}>
              · {ride.driverId.vehicleInfo.color} {ride.driverId.vehicleInfo.make} {ride.driverId.vehicleInfo.model}
            </span>
          )}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {canCancel && (
          <button onClick={handleCancel} className="btn btn-danger btn-sm">
            Cancel Ride
          </button>
        )}

        {canRate && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Rate:</span>
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                onClick={() => handleRate(star)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 22, padding: '0 2px', transition: 'transform 0.15s',
                }}
                onMouseEnter={(e) => (e.target.style.transform = 'scale(1.3)')}
                onMouseLeave={(e) => (e.target.style.transform = 'scale(1)')}
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

function InfoChip({ label, value, highlight }) {
  return (
    <div style={{
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      padding: '6px 12px',
      fontSize: 13,
    }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}: </span>
      <strong style={{ color: highlight ? 'var(--amber)' : 'var(--text-primary)' }}>{value}</strong>
    </div>
  );
}
