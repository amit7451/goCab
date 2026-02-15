import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Home() {
  const { isAuthenticated, isDriver, isUser } = useAuth();

  return (
    <div style={{ overflow: 'hidden' }}>
      {/* Hero */}
      <section style={styles.hero}>
        <div style={styles.heroBg} />
        <div className="container" style={{ position: 'relative', zIndex: 1 }}>
          <div style={styles.heroContent}>
            <div style={styles.badge}>🚕 Ride Smarter, Arrive Faster</div>
            <h1 style={styles.heroTitle}>
              Your City.<br />
              <span style={{ color: 'var(--amber)' }}>Your Ride.</span>
            </h1>
            <p style={styles.heroSub}>
              GoCab connects you with reliable drivers across the city in seconds.
              Fast, safe, and affordable rides — anytime, anywhere.
            </p>
            <div style={styles.heroActions}>
              {!isAuthenticated && (
                <>
                  <Link to="/register" className="btn btn-primary btn-lg">Get Started Free</Link>
                  <Link to="/login" className="btn btn-secondary btn-lg">Log In</Link>
                </>
              )}
              {isAuthenticated && isUser && (
                <Link to="/book" className="btn btn-primary btn-lg">Book a Ride Now →</Link>
              )}
              {isAuthenticated && isDriver && (
                <Link to="/driver" className="btn btn-primary btn-lg">Go to Dashboard →</Link>
              )}
            </div>

            {/* Quick stats */}
            <div style={styles.heroStats}>
              {[
                { value: '50K+', label: 'Happy Riders' },
                { value: '2K+', label: 'Pro Drivers' },
                { value: '4.9★', label: 'Average Rating' },
                { value: '24/7', label: 'Available' },
              ].map((s) => (
                <div key={s.label} style={styles.heroStat}>
                  <div style={styles.heroStatValue}>{s.value}</div>
                  <div style={styles.heroStatLabel}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section style={styles.features}>
        <div className="container">
          <div style={styles.sectionHead}>
            <div style={styles.sectionEyebrow}>Why GoCab?</div>
            <h2 style={styles.sectionTitle}>Everything you need in a ride</h2>
          </div>
          <div style={styles.featureGrid}>
            {FEATURES.map((f) => (
              <div key={f.title} className="card" style={styles.featureCard}>
                <div style={styles.featureIcon}>{f.icon}</div>
                <h3 style={styles.featureTitle}>{f.title}</h3>
                <p style={styles.featureDesc}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Ride types */}
      <section style={{ ...styles.features, background: 'var(--bg-secondary)' }}>
        <div className="container">
          <div style={styles.sectionHead}>
            <div style={styles.sectionEyebrow}>Fleet Options</div>
            <h2 style={styles.sectionTitle}>Choose your comfort level</h2>
          </div>
          <div style={styles.fleetGrid}>
            {FLEET.map((f) => (
              <div
                key={f.name}
                className="card"
                style={{ ...styles.fleetCard, borderColor: f.featured ? 'var(--amber)' : undefined }}
              >
                {f.featured && (
                  <div style={styles.popularBadge}>Most Popular</div>
                )}
                <div style={styles.fleetIcon}>{f.icon}</div>
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 20, marginBottom: 6 }}>{f.name}</h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 16 }}>{f.desc}</p>
                <div style={{ color: 'var(--amber)', fontWeight: 700, fontSize: 18 }}>From ₹{f.from}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      {!isAuthenticated && (
        <section style={styles.cta}>
          <div className="container" style={{ textAlign: 'center' }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'clamp(28px, 4vw, 44px)', marginBottom: 12 }}>
              Ready to ride with <span style={{ color: 'var(--amber)' }}>GoCab</span>?
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: 17, marginBottom: 32 }}>
              Join thousands of satisfied riders today.
            </p>
            <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
              <Link to="/register?role=user" className="btn btn-primary btn-lg">I'm a Passenger</Link>
              <Link to="/register?role=driver" className="btn btn-secondary btn-lg">I'm a Driver</Link>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

const FEATURES = [
  { icon: '⚡', title: 'Instant Matching', desc: 'Get matched with the nearest available driver in under 60 seconds.' },
  { icon: '🔒', title: 'Safe & Secure', desc: 'Every driver is verified. Your rides are encrypted and protected.' },
  { icon: '💰', title: 'Transparent Fares', desc: 'Know your fare before you book. No surge surprises.' },
  { icon: '⭐', title: 'Rate & Review', desc: 'Rate every ride and help maintain quality across the platform.' },
  { icon: '📍', title: 'Live Tracking', desc: 'Track your driver in real-time from acceptance to arrival.' },
  { icon: '💳', title: 'Flexible Payment', desc: 'Pay with cash or card — whatever suits you.' },
];

const FLEET = [
  { icon: '🚗', name: 'Economy', desc: 'Affordable everyday rides', from: 30, featured: false },
  { icon: '🚙', name: 'Comfort', desc: 'More room, smoother ride', from: 50, featured: true },
  { icon: '🏎️', name: 'Premium', desc: 'Luxury vehicles, VIP experience', from: 80, featured: false },
];

const styles = {
  hero: {
    position: 'relative',
    padding: '90px 0 80px',
    overflow: 'hidden',
  },
  heroBg: {
    position: 'absolute',
    inset: 0,
    background: `
      radial-gradient(ellipse at 20% 50%, rgba(245,158,11,0.07) 0%, transparent 50%),
      radial-gradient(ellipse at 80% 20%, rgba(59,130,246,0.05) 0%, transparent 50%)
    `,
    pointerEvents: 'none',
  },
  heroContent: { maxWidth: 680 },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    background: 'var(--amber-glow)',
    border: '1px solid rgba(245,158,11,0.25)',
    borderRadius: 999,
    padding: '6px 16px',
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--amber)',
    marginBottom: 24,
    letterSpacing: '0.02em',
  },
  heroTitle: {
    fontSize: 'clamp(44px, 7vw, 72px)',
    lineHeight: 1.05,
    marginBottom: 20,
  },
  heroSub: {
    fontSize: 18,
    color: 'var(--text-secondary)',
    lineHeight: 1.7,
    marginBottom: 36,
    maxWidth: 520,
  },
  heroActions: {
    display: 'flex',
    gap: 14,
    flexWrap: 'wrap',
    marginBottom: 56,
  },
  heroStats: {
    display: 'flex',
    gap: 36,
    flexWrap: 'wrap',
    paddingTop: 32,
    borderTop: '1px solid var(--border)',
  },
  heroStat: { textAlign: 'center' },
  heroStatValue: {
    fontFamily: 'var(--font-display)',
    fontSize: 26,
    fontWeight: 800,
    color: 'var(--amber)',
    marginBottom: 2,
  },
  heroStatLabel: {
    fontSize: 12,
    color: 'var(--text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  features: { padding: '80px 0' },
  sectionHead: { textAlign: 'center', marginBottom: 48 },
  sectionEyebrow: {
    color: 'var(--amber)',
    fontSize: 13,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 'clamp(26px, 4vw, 38px)',
    fontFamily: 'var(--font-display)',
  },
  featureGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: 20,
  },
  featureCard: { padding: 28 },
  featureIcon: { fontSize: 36, marginBottom: 16 },
  featureTitle: {
    fontFamily: 'var(--font-display)',
    fontSize: 18,
    marginBottom: 8,
  },
  featureDesc: { color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.6 },
  fleetGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
    gap: 20,
  },
  fleetCard: { padding: 28, position: 'relative', overflow: 'hidden' },
  popularBadge: {
    position: 'absolute',
    top: 14,
    right: 14,
    background: 'var(--amber)',
    color: '#080e1e',
    fontSize: 10,
    fontWeight: 800,
    padding: '3px 10px',
    borderRadius: 999,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  fleetIcon: { fontSize: 44, marginBottom: 14 },
  cta: {
    padding: '80px 0',
    background: `
      radial-gradient(ellipse at 50% 50%, rgba(245,158,11,0.08) 0%, transparent 60%),
      var(--bg-secondary)
    `,
  },
};
