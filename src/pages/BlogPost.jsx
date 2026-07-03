/**
 * BlogPost.jsx — renders a single blog post by slug.
 * Place at: src/pages/BlogPost.jsx
 * Route suggestion: <Route path="/blog/:slug" element={<BlogPost />} />
 *
 * Adding a new post never requires touching this file — just add an entry
 * to src/data/blogData.js.
 */
import { useEffect } from 'react';
import { useParams, Link, Navigate } from 'react-router-dom';
import { getBlogPostBySlug } from '@/data/blogData';
import { useDocumentMeta } from '@/hooks/useDocumentMeta';

const PRIMARY = '#2563eb';

const styles = {
  page: { fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", color: '#09090b', background: '#fff', minHeight: '100vh' },
  container: { maxWidth: 720, margin: '0 auto', padding: '0 24px' },
  header: { padding: '120px 0 40px', background: 'linear-gradient(180deg,#eff6ff 0%,#ffffff 100%)' },
  backLink: { display: 'inline-block', marginBottom: 24, color: PRIMARY, fontWeight: 600, textDecoration: 'none', fontSize: 15 },
  meta: { fontSize: 13, color: PRIMARY, fontWeight: 600, marginBottom: 12 },
  h1: { fontSize: 36, fontWeight: 800, lineHeight: 1.25, marginBottom: 8, color: '#09090b' },
  body: { padding: '20px 0 100px', fontSize: 17, lineHeight: 1.75, color: '#27272a' },
  h2: { fontSize: 24, fontWeight: 700, marginTop: 40, marginBottom: 16, color: '#09090b' },
  p: { marginBottom: 20 },
  list: { marginBottom: 20, paddingLeft: 24 },
  li: { marginBottom: 10 },
  cta: { marginTop: 48, padding: '32px', background: '#eff6ff', borderRadius: 16, textAlign: 'center' },
  ctaBtn: { display: 'inline-block', marginTop: 16, padding: '14px 28px', borderRadius: 12, fontWeight: 600, fontSize: 16, textDecoration: 'none', background: PRIMARY, color: '#fff' },
};

export default function BlogPost() {
  const { slug } = useParams();
  const post = getBlogPostBySlug(slug);

  useDocumentMeta({
    title: post ? `${post.title} — Skootlink Blog` : 'Post not found — Skootlink Blog',
    description: post?.metaDescription,
  });

  // Article structured data — inserted/removed manually since this is a
  // per-page script tag, not something useDocumentMeta's title/description
  // helper covers. Same JS-only caveat applies as noted in useDocumentMeta.js.
  useEffect(() => {
    if (!post) return;
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.text = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: post.title,
      description: post.metaDescription,
      datePublished: post.publishDate,
      author: { '@type': 'Organization', name: 'Skootlink' },
      publisher: { '@type': 'Organization', name: 'Skootlink' },
    });
    document.head.appendChild(script);
    return () => document.head.removeChild(script);
  }, [post]);

  if (!post) return <Navigate to="/blog" replace />;

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div style={styles.container}>
          <Link to="/blog" style={styles.backLink}>← Back to blog</Link>
          <p style={styles.meta}>
            {new Date(post.publishDate).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })} · {post.readTime}
          </p>
          <h1 style={styles.h1}>{post.title}</h1>
        </div>
      </header>

      <div style={styles.container}>
        <article style={styles.body}>
          {post.content.map((block, i) => {
            if (block.type === 'h2') return <h2 key={i} style={styles.h2}>{block.text}</h2>;
            if (block.type === 'list') return (
              <ul key={i} style={styles.list}>
                {block.items.map((item, j) => <li key={j} style={styles.li}>{item}</li>)}
              </ul>
            );
            return <p key={i} style={styles.p}>{block.text}</p>;
          })}

          <div style={styles.cta}>
            <p style={{ fontSize: 18, fontWeight: 600 }}>Ready to find a vehicle?</p>
            <p style={{ color: '#71717a', marginTop: 8 }}>Browse cars, bikes, and scooters available to rent near you.</p>
            <a href="/auth" style={styles.ctaBtn}>Get Started →</a>
          </div>
        </article>
      </div>
    </div>
  );
}
