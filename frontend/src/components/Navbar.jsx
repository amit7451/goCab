import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Navbar() {
  const { isAuthenticated, isDriver, isUser, user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  return (
    <nav style={styles.nav}>
      <div style={styles.inner}>
        {/* Logo */}
        <Link to="/" style={styles.logo}>
          <span style={styles.logoIcon}>🚕</span>
          <span style={styles.logoText}>
            Go<span style={{ color: 'var(--amber)' }}>Cab</span>
          </span>
        </Link>

        {/* Nav links */}
        <div style={styles.links}>
          {isAuthenticated && isUser && (
            <>
              <NavLink
                to="/book"
                style={({ isActive }) => ({ ...styles.link, ...(isActive ? styles.linkActive : {}) })}
              >
                Book Ride
              </NavLink>
              <NavLink
                to="/my-rides"
                style={({ isActive }) => ({ ...styles.link, ...(isActive ? styles.linkActive : {}) })}
              >
                My Rides
              </NavLink>
            </>
          )}

          {isAuthenticated && isDriver && (
            <NavLink
              to="/driver"
              style={({ isActive }) => ({ ...styles.link, ...(isActive ? styles.linkActive : {}) })}
            >
              Dashboard
            </NavLink>
          )}
        </div>

        {/* Auth actions */}
        <div style={styles.actions}>
          {isAuthenticated ? (
            <>
              <span style={styles.greeting}>
                Hi, <strong>{user?.name?.split(' ')[0]}</strong>
                <span style={styles.rolePill}>{user?.role}</span>
              </span>
              <button onClick={handleLogout} className="btn btn-ghost btn-sm">
                Log Out
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="btn btn-ghost btn-sm">Log In</Link>
              <Link to="/register" className="btn btn-primary btn-sm">Sign Up</Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}

const styles = {
  nav: {
    background: 'rgba(8, 14, 30, 0.92)',
    backdropFilter: 'blur(12px)',
    borderBottom: '1px solid var(--border)',
    position: 'sticky',
    top: 0,
    zIndex: 100,
    height: 68,
  },
  inner: {
    maxWidth: 1200,
    margin: '0 auto',
    padding: '0 24px',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    textDecoration: 'none',
    flexShrink: 0,
  },
  logoIcon: {
    fontSize: 22,
  },
  logoText: {
    fontFamily: 'var(--font-display)',
    fontSize: 22,
    fontWeight: 800,
    color: 'var(--text-primary)',
  },
  links: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    flex: 1,
    justifyContent: 'center',
  },
  link: {
    padding: '8px 16px',
    borderRadius: 8,
    textDecoration: 'none',
    color: 'var(--text-secondary)',
    fontSize: 15,
    fontWeight: 500,
    transition: 'color 0.2s, background 0.2s',
  },
  linkActive: {
    color: 'var(--amber)',
    background: 'var(--amber-glow)',
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexShrink: 0,
  },
  greeting: {
    fontSize: 14,
    color: 'var(--text-secondary)',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  rolePill: {
    background: 'var(--amber-glow)',
    color: 'var(--amber)',
    border: '1px solid rgba(245,158,11,0.3)',
    borderRadius: 999,
    padding: '2px 8px',
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
};
