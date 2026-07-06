/**
 * CityLandingPage.jsx — reusable landing page for "rent a car for Uber/Bolt
 * in [City]" style commercial searches. One route/component serves every
 * city listed in cityLandingData.js.
 *
 * Place at: src/pages/CityLandingPage.jsx
 * Route suggestion: <Route path="/rent-a-car-for-uber-:city" element={<CityLandingPage />} />
 * (so /rent-a-car-for-uber-johannesburg resolves city="johannesburg")
 */
import { useEffect } from 'react';
import { useParams, Link, Navigate } from 'react-router-dom';
import { getCityPage } from '@/data/cityLandingData';
import { useDocumentMeta } from '@/hooks/useDocumentMeta';

const PRIMARY = '#2563eb';
const PRIMARY_DARK = '#1d4ed8';

const styles = {
  page: { fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", color: '#09090b', background: '#fff', minHeight: '100vh' },
  container: { maxWidth: 800, margin: '0 auto', padding: '0 24px' },
  header: { padding: '120px 0 60px', textAlign: 'center', background: 'linear-gradient(180deg,#eff6ff 0%,#ffffff 100%)' },
  backLink: { display: 'inline-block', marginBottom: 24, color: PRIMARY, fontWeight: 600, textDecoration: 'none', fontSize: 15 },
  h1: { fontSize: 40, fontWeight: 800, lineHeight: 1.2, marginBottom: 20, color: '#09090b' },
  intro: { fontSize: 19, color: '#71717a', maxWidth: 640, margin: '0 auto 32px' },
  ctaBtn: { display: 'inline-block', padding: '18px 36px', borderRadius: 12, fontWeight: 600, fontSize: 18, textDecoration: 'none', background: PRIMARY, color: '#fff', border: 'none', cursor: 'pointer', transition: 'background .2s' },
  body: { padding: '60px 0 100px' },
  sectionTitle: { fontSize: 28, fontWeight: 700, marginBottom: 24, textAlign: 'center' },
  list: { listStyle: 'none', padding: 0, maxWidth: 640, margin: '0 auto' },
  li: { display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 16, fontSize: 16, color: '#27272a' },
  check: { color: PRIMARY, fontWeight: 700, flexShrink: 0 },
};

export default function CityLandingPage() {
  const { city } = useParams();
  const page = getCityPage(city);

  useDocumentMeta({
    title: page ? `${page.heading} | Skootlink` : 'City not found — Skootlink',
    description: page ? `${page.intro.slice(0, 150)}` : undefined,
  });

  useEffect(() => {
    if (!page) return;
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.text = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Service',
      serviceType: 'Vehicle rental for gig-economy drivers',
      provider: { '@type': 'Organization', name: 'Skootlink' },
      areaServed: { '@type': 'City', name: page.cityName, containedInPlace: { '@type': 'State', name: page.province } },
      audience: { '@type': 'Audience', audienceType: 'Uber and Bolt drivers' },
    });
    document.head.appendChild(script);
    return () => document.head.removeChild(script);
  }, [page]);

  if (!page) return <Navigate to="/" replace />;

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div style={styles.container}>
          <Link to="/" style={styles.backLink}>← Back to home</Link>
          <h1 style={styles.h1}>{page.heading}</h1>
          <p style={styles.intro}>{page.intro}</p>
          <a href="/search-vehicles" style={styles.ctaBtn}
            onMouseEnter={e => (e.currentTarget.style.background = PRIMARY_DARK)}
            onMouseLeave={e => (e.currentTarget.style.background = PRIMARY)}
          >
            Browse Vehicles in {page.cityName} →
          </a>
        </div>
      </header>

      <div style={styles.container}>
        <div style={styles.body}>
          <h2 style={styles.sectionTitle}>Why rent through Skootlink in {page.cityName}?</h2>
          <ul style={styles.list}>
            {page.highlights.map((h, i) => (
              <li key={i} style={styles.li}>
                <span style={styles.check}>✓</span>
                <span>{h}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
