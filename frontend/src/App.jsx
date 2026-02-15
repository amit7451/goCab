import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Navbar from './components/Navbar';
import ProtectedRoute from './components/ProtectedRoute';
import Home from './pages/Home';
import Login from './pages/Login';
import Register from './pages/Register';
import BookRide from './pages/BookRide';
import MyRides from './pages/MyRides';
import DriverDashboard from './pages/DriverDashboard';

export default function App() {
  const { loading } = useAuth();

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner" style={{ width: 40, height: 40 }} />
        <p style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-display)' }}>
          Starting GoCab…
        </p>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Navbar />
      <Routes>
        {/* Public routes */}
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />

        {/* Passenger-only routes */}
        <Route
          path="/book"
          element={
            <ProtectedRoute requiredRole="user">
              <BookRide />
            </ProtectedRoute>
          }
        />
        <Route
          path="/my-rides"
          element={
            <ProtectedRoute requiredRole="user">
              <MyRides />
            </ProtectedRoute>
          }
        />

        {/* Driver-only routes */}
        <Route
          path="/driver"
          element={
            <ProtectedRoute requiredRole="driver">
              <DriverDashboard />
            </ProtectedRoute>
          }
        />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
