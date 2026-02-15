import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../api/axios';
import toast from 'react-hot-toast';

const RIDE_TYPES = [
  { id: 'economy', label: 'Economy', icon: '🚗', desc: 'Affordable & practical', baseFrom: 30 },
  { id: 'comfort', label: 'Comfort', icon: '🚙', desc: 'Extra space & comfort', baseFrom: 50 },
  { id: 'premium', label: 'Premium', icon: '🏎️', desc: 'Luxury experience', baseFrom: 80 },
];

const PAYMENT_METHODS = [
  { id: 'cash', label: 'Cash', icon: '💵' },
  { id: 'card', label: 'Card', icon: '💳' },
];

export default function BookRide() {
  const navigate = useNavigate();

  const [form, setForm] = useState({
    pickupAddress: '',
    dropoffAddress: '',
    rideType: 'economy',
    paymentMethod: 'cash',
  });

  const [loading, setLoading] = useState(false);
  const [fareEstimate, setFareEstimate] = useState(null);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });
  const handleSelect = (key, value) => setForm({ ...form, [key]: value });

  // Rough fare estimate for display
  const estimateFare = () => {
    const rates = { economy: { base: 30, perKm: 12 }, comfort: { base: 50, perKm: 18 }, premium: { base: 80, perKm: 25 } };
    const r = rates[form.rideType];
    const avgKm = 8;
    return r.base + avgKm * r.perKm;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!form.pickupAddress.trim() || !form.dropoffAddress.trim()) {
      toast.error('Please enter both pickup and drop-off locations');
      return;
    }

    if (form.pickupAddress.trim() === form.dropoffAddress.trim()) {
      toast.error('Pickup and drop-off cannot be the same');
      return;
    }

    setLoading(true);
    try {
      const payload = {
        pickup: { address: form.pickupAddress.trim() },
        dropoff: { address: form.dropoffAddress.trim() },
        rideType: form.rideType,
        paymentMethod: form.paymentMethod,
      };

      const res = await API.post('/rides/book', payload);
      const { ride } = res.data;

      toast.success('🚕 Ride booked! Looking for a driver…');
      navigate('/my-rides');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Booking failed. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page">
      <div className="container" style={{ maxWidth: 680 }}>
        <div className="page-header">
          <h1>Book a <span>Ride</span></h1>
          <p>Enter your pickup and drop-off to get started</p>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Locations */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="section-title" style={{ fontSize: 15, marginBottom: 18 }}>
              📍 Route Details
            </div>

            <div className="form-group">
              <label className="form-label">Pickup Location</label>
              <input
                className="form-input"
                type="text"
                name="pickupAddress"
                placeholder="Enter your pickup address…"
                value={form.pickupAddress}
                onChange={handleChange}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '4px 0 4px 10px' }}>
              <div style={{ width: 2, height: 28, background: 'var(--border)', borderRadius: 1 }} />
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>to</span>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Drop-off Location</label>
              <input
                className="form-input"
                type="text"
                name="dropoffAddress"
                placeholder="Enter your destination…"
                value={form.dropoffAddress}
                onChange={handleChange}
              />
            </div>
          </div>

          {/* Ride type */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="section-title" style={{ fontSize: 15, marginBottom: 18 }}>
              🚗 Ride Type
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              {RIDE_TYPES.map((rt) => (
                <button
                  key={rt.id}
                  type="button"
                  onClick={() => handleSelect('rideType', rt.id)}
                  style={{
                    background: form.rideType === rt.id ? 'var(--amber-glow)' : 'var(--bg-elevated)',
                    border: `1.5px solid ${form.rideType === rt.id ? 'var(--amber)' : 'var(--border)'}`,
                    borderRadius: 'var(--radius)',
                    padding: '16px 12px',
                    cursor: 'pointer',
                    textAlign: 'center',
                    transition: 'all 0.2s',
                  }}
                >
                  <div style={{ fontSize: 28, marginBottom: 6 }}>{rt.icon}</div>
                  <div style={{
                    fontFamily: 'var(--font-display)',
                    fontWeight: 700,
                    fontSize: 15,
                    color: form.rideType === rt.id ? 'var(--amber)' : 'var(--text-primary)',
                    marginBottom: 3,
                  }}>
                    {rt.label}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{rt.desc}</div>
                  <div style={{
                    marginTop: 6,
                    fontSize: 12,
                    fontWeight: 700,
                    color: form.rideType === rt.id ? 'var(--amber)' : 'var(--text-secondary)',
                  }}>
                    from ₹{rt.baseFrom}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Payment */}
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="section-title" style={{ fontSize: 15, marginBottom: 18 }}>
              💳 Payment Method
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {PAYMENT_METHODS.map((pm) => (
                <button
                  key={pm.id}
                  type="button"
                  onClick={() => handleSelect('paymentMethod', pm.id)}
                  style={{
                    background: form.paymentMethod === pm.id ? 'var(--amber-glow)' : 'var(--bg-elevated)',
                    border: `1.5px solid ${form.paymentMethod === pm.id ? 'var(--amber)' : 'var(--border)'}`,
                    borderRadius: 'var(--radius)',
                    padding: '14px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    transition: 'all 0.2s',
                  }}
                >
                  <span style={{ fontSize: 22 }}>{pm.icon}</span>
                  <span style={{
                    fontWeight: 600,
                    fontSize: 15,
                    color: form.paymentMethod === pm.id ? 'var(--amber)' : 'var(--text-primary)',
                  }}>
                    {pm.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Fare estimate preview */}
          {form.pickupAddress && form.dropoffAddress && (
            <div style={{
              background: 'var(--amber-glow)',
              border: '1px solid rgba(245,158,11,0.25)',
              borderRadius: 'var(--radius)',
              padding: '14px 20px',
              marginBottom: 20,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
                💡 Estimated fare (avg 8 km)
              </span>
              <span style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 800,
                fontSize: 20,
                color: 'var(--amber)',
              }}>
                ~₹{estimateFare()}
              </span>
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary btn-full btn-lg"
            disabled={loading}
          >
            {loading ? (
              <><div className="spinner" style={{ width: 18, height: 18 }} /> Booking your ride…</>
            ) : (
              '🚕 Confirm Booking'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
