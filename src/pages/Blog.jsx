/**
 * Blog.jsx — public blog index page.
 * Place at: src/pages/Blog.jsx
 * Route suggestion: <Route path="/blog" element={<Blog />} />
 */
import { Link } from 'react-router-dom';
import { BLOG_POSTS } from '@/data/blogData';
import { useDocumentMeta } from '@/hooks/useDocumentMeta';

const PRIMARY = '#2563eb';
const DARK = '#18181b';

const styles = {
  page: { fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", color: '#09090b', background: '#fff', minHeight: '100vh' },
  container: { maxWidth: 900, margin: '0 auto', padding: '0 24px' },
  header: { padding: '120px 0 60px', textAlign: 'center', background: 'linear-gradient(180deg,#eff6ff 0%,#ffffff 100%)' },
  h1: { fontSize: 40, fontWeight: 800, marginBottom: 12, color: '#09090b' },
  sub: { fontSize: 18, color: '#71717a', maxWidth: 560, margin: '0 auto' },
  list: { padding: '60px 0 100px', display: 'flex', flexDirection: 'column', gap: 24 },
  card: { display: 'block', textDecoration: 'none', color: 'inherit', background: '#eff6ff', borderRadius: 16, padding: '32px', transition: 'transform .2s, box-shadow .2s' },
  cardMeta: { fontSize: 13, color: PRIMARY, fontWeight: 600, marginBottom: 8 },
  cardTitle: { fontSize: 24, fontWeight: 700, marginBottom: 8, color: '#09090b' },
  cardExcerpt: { fontSize: 15, color: '#71717a', lineHeight: 1.6 },
  backLink: { display: 'inline-block', marginBottom: 24, color: PRIMARY, fontWeight: 600, textDecoration: 'none', fontSize: 15 },
};

export default function Blog() {
  useDocumentMeta({
    title: 'Blog — Skootlink | Gig Driving & Vehicle Rental Guides for South Africa',
    description: 'Guides on driving for Uber, Bolt, and delivery apps in South Africa — vehicle rental tips, cost breakdowns, and how to get started without owning a car.',
  });

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div style={styles.container}>
          <h1 style={styles.h1}>Skootlink Blog</h1>
          <p style={styles.sub}>Guides for gig drivers on renting vehicles, working with Uber, Bolt, and delivery apps in South Africa.</p>
        </div>
      </header>

      <div style={styles.container}>
        <Link to="/" style={styles.backLink}>← Back to home</Link>
        <div style={styles.list}>
          {BLOG_POSTS.slice().reverse().map(post => (
            <Link
              key={post.slug}
              to={`/blog/${post.slug}`}
              style={styles.card}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 12px 24px -8px rgba(37,99,235,.2)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}
            >
              <p style={styles.cardMeta}>{new Date(post.publishDate).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })} · {post.readTime}</p>
              <h2 style={styles.cardTitle}>{post.title}</h2>
              <p style={styles.cardExcerpt}>{post.excerpt}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
