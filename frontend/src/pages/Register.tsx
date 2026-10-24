import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import { UserRole } from '../types';

const INITIAL_USER = { name: '', email: '', password: '', phone: '' };
const INITIAL_VEHICLE = { make: '', model: '', year: '', color: '', licensePlate: '' };

export default function Register(): React.ReactElement {
  const { register, isAuthenticated, user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [role, setRole] = useState<UserRole>(
    searchParams.get('role') === 'driver' ? 'driver' : 'user'
  );
  const [form, setForm] = useState(INITIAL_USER);
  const [vehicle, setVehicle] = useState(INITIAL_VEHICLE);
  const [licenseNumber, setLicenseNumber] = useState('');
  const [loading, setLoading] = useState(false);

  // Declarative redirect if already authenticated
  if (isAuthenticated) {
    const target = user?.role === 'driver' ? '/driver' : '/';
    return <Navigate to={target} replace />;
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleVehicleChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    setVehicle({ ...vehicle, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();

    if (!form.name.trim() || !form.email.trim() || !form.password || !form.phone.trim()) {
      toast.error('Please fill in all required fields');
      return;
    }

    if (form.password.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }

    if (role === 'driver') {
      if (
        !vehicle.make.trim() ||
        !vehicle.model.trim() ||
        !vehicle.year ||
        !vehicle.licensePlate.trim() ||
        !vehicle.color.trim()
      ) {
        toast.error('Please fill in all vehicle details');
        return;
      }
      if (!licenseNumber.trim()) {
        toast.error('License number is required');
        return;
      }
    }

    const payload: Record<string, any> = {
      name: form.name.trim(),
      email: form.email.trim(),
      password: form.password,
      phone: form.phone.trim(),
      role,
      ...(role === 'driver' && {
        vehicleInfo: {
          make: vehicle.make.trim(),
          model: vehicle.model.trim(),
          year: parseInt(vehicle.year, 10),
          licensePlate: vehicle.licensePlate.trim().toUpperCase(),
          color: vehicle.color.trim(),
        },
        licenseNumber: licenseNumber.trim(),
      }),
    };

    setLoading(true);
    try {
      const createdUser = await register(payload);
      toast.success(`Account created! Welcome, ${createdUser.name.split(' ')[0]}!`);
      navigate(createdUser.role === 'driver' ? '/driver' : '/book', { replace: true });
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page" style={{ alignItems: 'flex-start', paddingTop: 40 }}>
      <div className="auth-card" style={{ maxWidth: 520 }}>
        {/* Logo */}
        <div className="auth-logo">
          <div className="auth-logo-icon">🚕</div>
          <div className="auth-logo-text">
            Go<span>Cab</span>
          </div>
        </div>

        <h1 className="auth-title">Create account</h1>
        <p className="auth-subtitle">Join GoCab today — it's free</p>

        {/* Role toggle */}
        <div className="role-toggle">
          <button
            type="button"
            className={`role-btn ${role === 'user' ? 'active' : ''}`}
            onClick={() => setRole('user')}
          >
            🧑 I'm a Passenger
          </button>
          <button
            type="button"
            className={`role-btn ${role === 'driver' ? 'active' : ''}`}
            onClick={() => setRole('driver')}
          >
            🚗 I'm a Driver
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Basic info */}
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Full Name</label>
              <input
                className="form-input"
                type="text"
                name="name"
                placeholder="John Doe"
                value={form.name}
                onChange={handleChange}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Phone</label>
              <input
                className="form-input"
                type="tel"
                name="phone"
                placeholder="+91 99999 00000"
                value={form.phone}
                onChange={handleChange}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Email Address</label>
            <input
              className="form-input"
              type="email"
              name="email"
              placeholder="you@example.com"
              value={form.email}
              onChange={handleChange}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Password</label>
            <input
              className="form-input"
              type="password"
              name="password"
              placeholder="Minimum 6 characters"
              value={form.password}
              onChange={handleChange}
            />
          </div>

          {/* Driver fields */}
          {role === 'driver' && (
            <>
              <div
                style={{
                  borderTop: '1px solid var(--border)',
                  margin: '8px 0 20px',
                  paddingTop: 20,
                }}
              >
                <div className="section-title" style={{ fontSize: 15 }}>
                  Vehicle Information
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Make (Brand)</label>
                  <input
                    className="form-input"
                    type="text"
                    name="make"
                    placeholder="e.g. Maruti"
                    value={vehicle.make}
                    onChange={handleVehicleChange}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Model</label>
                  <input
                    className="form-input"
                    type="text"
                    name="model"
                    placeholder="e.g. Swift"
                    value={vehicle.model}
                    onChange={handleVehicleChange}
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Year</label>
                  <input
                    className="form-input"
                    type="number"
                    name="year"
                    placeholder="2020"
                    min="2000"
                    max={new Date().getFullYear()}
                    value={vehicle.year}
                    onChange={handleVehicleChange}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Color</label>
                  <input
                    className="form-input"
                    type="text"
                    name="color"
                    placeholder="e.g. White"
                    value={vehicle.color}
                    onChange={handleVehicleChange}
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">License Plate</label>
                  <input
                    className="form-input"
                    type="text"
                    name="licensePlate"
                    placeholder="DL01AB1234"
                    value={vehicle.licensePlate}
                    onChange={handleVehicleChange}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Driver License No.</label>
                  <input
                    className="form-input"
                    type="text"
                    name="licenseNumber"
                    placeholder="DL-123456789"
                    value={licenseNumber}
                    onChange={(e) => setLicenseNumber(e.target.value)}
                  />
                </div>
              </div>
            </>
          )}

          <button
            type="submit"
            className="btn btn-primary btn-full btn-lg"
            disabled={loading}
            style={{ marginTop: 8 }}
          >
            {loading ? (
              <>
                <div className="spinner" style={{ width: 18, height: 18 }} /> Creating account…
              </>
            ) : (
              `Create ${role === 'driver' ? 'Driver' : 'Passenger'} Account →`
            )}
          </button>
        </form>

        <div className="auth-footer">
          Already have an account? <Link to="/login">Log in</Link>
        </div>
      </div>
    </div>
  );
}
