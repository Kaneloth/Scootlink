import { useState, useEffect } from "react";
import { supabase } from '@/api/supabaseClient';

const openAuth = () => window.location.href = '/auth';

const PRIMARY = "#2563eb";
const PRIMARY_DARK = "#1d4ed8";
const DARK = "#18181b";

const styles = {
  container: { maxWidth: 1200, margin: "0 auto", padding: "0 24px" },
  navbar: {
    position: "fixed", top: 0, left: 0, right: 0, zIndex: 100,
    background: "rgba(255,255,255,0.97)", backdropFilter: "blur(10px)",
    borderBottom: "1px solid #dbeafe", padding: "16px 0",
    transition: "box-shadow .2s",
  },
  navInner: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  logo: { fontSize: 0, fontWeight: 800, color: PRIMARY, textDecoration: "none", display: "flex", alignItems: "center", gap: 8 },
  navList: { display: "flex", gap: 32, listStyle: "none" },
  navLink: { textDecoration: "none", color: "#09090b", fontWeight: 500, fontSize: 15, transition: "color .2s", cursor: "pointer" },
  btnBase: { display: "inline-block", padding: "14px 28px", borderRadius: 12, fontWeight: 600, fontSize: 16, textDecoration: "none", transition: "all .2s", cursor: "pointer", border: "none" },
  btnPrimary: { background: PRIMARY, color: "#fff" },
  btnOutline: { background: "transparent", color: PRIMARY, border: `2px solid ${PRIMARY}` },
  btnLarge: { padding: "18px 36px", fontSize: 18 },
  hero: { padding: "160px 0 100px", textAlign: "center", background: "linear-gradient(180deg,#eff6ff 0%,#ffffff 100%)" },
  heroH1: { fontSize: 48, fontWeight: 800, lineHeight: 1.2, marginBottom: 20, color: "#09090b" },
  heroSpan: { color: PRIMARY },
  heroPara: { fontSize: 20, color: "#71717a", maxWidth: 700, margin: "0 auto 40px" },
  heroBtns: { display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap" },
  section: { padding: "100px 0" },
  sectionAlt: { padding: "100px 0", background: "#eff6ff" },
  sectionTitle: { fontSize: 36, fontWeight: 700, textAlign: "center", marginBottom: 16 },
  sectionSub: { fontSize: 18, color: "#71717a", textAlign: "center", maxWidth: 600, margin: "0 auto 60px" },
  stepsGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 48 },
  stepCard: { background: "#eff6ff", borderRadius: 16, padding: "40px 32px" },
  stepCardH3: { fontSize: 22, marginBottom: 24, color: PRIMARY },
  stepItem: { display: "flex", gap: 16, marginBottom: 20 },
  stepNumber: { width: 40, height: 40, background: PRIMARY, color: "#fff", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 18, flexShrink: 0 },
  stepItemH4: { fontSize: 17, marginBottom: 4 },
  stepItemP: { color: "#71717a", fontSize: 15 },
  trustGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))", gap: 24 },
  trustCard: { background: "#fff", border: "1px solid #e4e4e7", borderRadius: 16, padding: "32px 24px", textAlign: "center" },
  trustIcon: { fontSize: 48, marginBottom: 16 },
  trustH4: { fontSize: 18, marginBottom: 8 },
  trustP: { color: "#71717a", fontSize: 14 },
  contentGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32 },
  contentCard: { background: "#eff6ff", borderRadius: 16, padding: "40px 32px" },
  contentH3: { fontSize: 24, marginBottom: 16 },
  contentP: { color: "#71717a", marginBottom: 12, fontSize: 15 },
  ctaSection: { padding: "100px 0", background: PRIMARY, color: "#fff", textAlign: "center" },
  ctaH2: { fontSize: 36, fontWeight: 700, textAlign: "center", marginBottom: 16, color: "#fff" },
  ctaP: { fontSize: 18, marginBottom: 32, opacity: 0.9 },
  ctaBtnWhite: { display: "inline-block", padding: "18px 36px", borderRadius: 12, fontWeight: 600, fontSize: 18, textDecoration: "none", background: "#fff", color: PRIMARY, cursor: "pointer", border: "none", transition: "all .2s" },
  ctaBtnGhost: { display: "inline-block", padding: "18px 36px", borderRadius: 12, fontWeight: 600, fontSize: 18, textDecoration: "none", background: "transparent", color: "#fff", border: "2px solid #fff", cursor: "pointer", transition: "all .2s" },
  formInput: { width: "100%", padding: 12, marginBottom: 12, border: "1px solid #dbeafe", borderRadius: 8, fontSize: 15, fontFamily: "inherit", outline: "none" },
  formTextarea: { width: "100%", padding: 12, marginBottom: 12, border: "1px solid #dbeafe", borderRadius: 8, fontSize: 15, fontFamily: "inherit", resize: "vertical", outline: "none" },
  footer: { background: DARK, color: "#fff", padding: "60px 0 30px" },
  footerGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 40, marginBottom: 40 },
  footerH4: { fontSize: 18, marginBottom: 16 },
  footerLink: { display: "block", color: "rgba(255,255,255,0.7)", textDecoration: "none", marginBottom: 8, fontSize: 14 },
  footerBottom: { borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: 24, textAlign: "center", fontSize: 14, color: "rgba(255,255,255,0.5)" },
};

const demoCSS = `
  .sl-demo-container { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; align-items: center; margin-top: 40px; }
  .sl-demo-video-wrapper { background: #fff; border-radius: 32px; box-shadow: 0 20px 35px -10px rgba(0,0,0,0.15); overflow: hidden; transition: transform 0.3s ease; }
  .sl-demo-video-wrapper:hover { transform: translateY(-5px); }
  .sl-demo-mockup { background: #1e1e2f; border-radius: 28px; padding: 16px 12px 12px 12px; }
  .sl-mockup-header { display: flex; gap: 8px; padding-bottom: 12px; padding-left: 8px; }
  .sl-mockup-dot { width: 12px; height: 12px; border-radius: 50%; background: #ff5f56; }
  .sl-mockup-dot:nth-child(2) { background: #ffbd2e; }
  .sl-mockup-dot:nth-child(3) { background: #27c93f; }
  .sl-mockup-screen { background: #fff; border-radius: 20px; overflow: hidden; aspect-ratio: 16/9; }
  .sl-demo-video { width: 100%; height: 100%; object-fit: cover; display: block; }
  .sl-demo-features { background: rgba(37,99,235,0.04); padding: 32px; border-radius: 32px; }
  .sl-demo-features h3 { font-size: 24px; margin-bottom: 20px; color: #2563eb; }
  .sl-demo-features ul { list-style: none; margin-bottom: 28px; padding: 0; }
  .sl-demo-features ul li { margin-bottom: 16px; font-size: 16px; display: flex; align-items: center; gap: 12px; }
  @media (max-width: 768px) {
    .sl-demo-container { grid-template-columns: 1fr; }
    .sl-steps-grid { grid-template-columns: 1fr !important; }
    .sl-content-grid { grid-template-columns: 1fr !important; }
    .sl-hero-h1 { font-size: 30px !important; }
    .sl-nav-links { display: none !important; }
  }
`;

function Navbar() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const scroll = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

  return (
    <nav style={{ ...styles.navbar, boxShadow: scrolled ? "0 2px 20px rgba(37,99,235,.1)" : "none" }}>
      <div style={{ ...styles.container, ...styles.navInner }}>
        <a href="#home" style={styles.logo} onClick={e => { e.preventDefault(); scroll("home"); }}>
          <img src="/logo.png" alt="Skootlink" style={{ height: 52, width: "auto" }} />
        </a>
        <ul style={styles.navList} className="sl-nav-links">
          {[["How It Works", "how-it-works"], ["Trust & Safety", "trust"], ["About", "about"], ["Contact", "contact"]].map(([label, id]) => (
            <li key={id}>
              <a href={`#${id}`} style={styles.navLink}
                onClick={e => { e.preventDefault(); scroll(id); }}
                onMouseEnter={e => (e.currentTarget.style.color = PRIMARY)}
                onMouseLeave={e => (e.currentTarget.style.color = "#09090b")}
              >{label}</a>
            </li>
          ))}
        </ul>
        <button
          style={{ ...styles.btnBase, ...styles.btnPrimary }}
          onClick={openAuth}
          onMouseEnter={e => (e.currentTarget.style.background = PRIMARY_DARK)}
          onMouseLeave={e => (e.currentTarget.style.background = PRIMARY)}
        >
          Sign In
        </button>
      </div>
    </nav>
  );
}

function Hero() {
  const scroll = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

  return (
    <section style={styles.hero} id="home">
      <div style={styles.container}>
        <h1 style={styles.heroH1} className="sl-hero-h1">
          The Formal Way to Rent{" "}
          <span style={styles.heroSpan}>Vehicles for Gig Work</span>{" "}
          in South Africa
        </h1>
        <p style={styles.heroPara}>
          Skootlink connects independent vehicle owners with gig workers who need temporary access to cars, vans, scooters, and other vehicles for delivery, scholar transport, and a range of earning opportunities.
        </p>
        <div style={styles.heroBtns}>
          <button
            style={{ ...styles.btnBase, ...styles.btnPrimary, ...styles.btnLarge }}
            onClick={openAuth}
            onMouseEnter={e => (e.currentTarget.style.background = PRIMARY_DARK)}
            onMouseLeave={e => (e.currentTarget.style.background = PRIMARY)}
          >
            🚀 Get Started
          </button>
          <a href="#how-it-works" style={{ ...styles.btnBase, ...styles.btnOutline, ...styles.btnLarge }}
            onClick={e => { e.preventDefault(); scroll("how-it-works"); }}
            onMouseEnter={e => (e.currentTarget.style.background = "#eff6ff")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
          >
            Learn More
          </a>
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section style={styles.sectionAlt} id="how-it-works">
      <div style={styles.container}>
        <h2 style={styles.sectionTitle}>How Skootlink Works</h2>
        <p style={styles.sectionSub}>A simple, secure process for both vehicle owners and drivers</p>
        <div style={styles.stepsGrid} className="sl-steps-grid">
          <div style={styles.stepCard}>
            <h3 style={styles.stepCardH3}>🚗 For Vehicle Owners</h3>
            {[
              ["List Your Vehicle", "Create a listing with photos, location, and your weekly price. Cars, scooters, motorbikes – any vehicle."],
              ["Find a Driver", "Search available drivers near you. Filter by location, experience, and rating."],
              ["We Verify Drivers", "Every driver is identity-checked and verified before they can rent. You approve who rents your vehicle."],
            ].map(([title, desc], i) => (
              <div key={i} style={styles.stepItem}>
                <div style={styles.stepNumber}>{i + 1}</div>
                <div><h4 style={styles.stepItemH4}>{title}</h4><p style={styles.stepItemP}>{desc}</p></div>
              </div>
            ))}
          </div>
          <div style={styles.stepCard}>
            <h3 style={styles.stepCardH3}>📦 For Drivers</h3>
            {[
              ["Find a Vehicle", "Search available cars, scooters, and bikes near you. Filter by location, type, price, and owner rating."],
              ["Book & Sign Contract", "Send a rental request. Once accepted, sign a digital rental agreement that protects both parties."],
              ["Start Delivering", "Pick up the vehicle and start earning, backed by a formal rental agreement that protects both you and the owner."],
            ].map(([title, desc], i) => (
              <div key={i} style={styles.stepItem}>
                <div style={styles.stepNumber}>{i + 1}</div>
                <div><h4 style={styles.stepItemH4}>{title}</h4><p style={styles.stepItemP}>{desc}</p></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function DemoSection() {
  return (
    <section style={styles.section} id="demo">
      <div style={styles.container}>
        <h2 style={styles.sectionTitle}>See Skootlink in Action</h2>
        <p style={styles.sectionSub}>Watch how easy it is to rent a delivery vehicle or list your own – in under 2 minutes.</p>
        <div className="sl-demo-container">
          <div className="sl-demo-video-wrapper">
            <div className="sl-demo-mockup">
              <div className="sl-mockup-header">
                <span className="sl-mockup-dot"></span>
                <span className="sl-mockup-dot"></span>
                <span className="sl-mockup-dot"></span>
              </div>
              <div className="sl-mockup-screen">
                <video className="sl-demo-video" poster="https://placehold.co/800x500/2563eb/white?text=Skootlink+Demo+Preview" controls controlsList="nodownload">
                  <source src="https://www.w3schools.com/html/mov_bbb.mp4" type="video/mp4" />
                  Your browser does not support the video tag.
                </video>
              </div>
            </div>
          </div>
          <div className="sl-demo-features">
            <h3>What you'll see in the demo:</h3>
            <ul>
              <li>🔍 Finding a scooter near you</li>
              <li>📝 Submitting a rental request</li>
              <li>✍️ Signing a digital contract</li>
              <li>💬 Messaging the owner directly</li>
            </ul>
            <button
              onClick={openAuth}
              style={{ ...styles.btnBase, ...styles.btnPrimary, width: "100%", marginBottom: 12 }}
              onMouseEnter={e => (e.currentTarget.style.background = PRIMARY_DARK)}
              onMouseLeave={e => (e.currentTarget.style.background = PRIMARY)}
            >
              🚀 Get Started — It's Free
            </button>
            <p style={{ fontSize: 13, color: "#71717a", textAlign: "center", marginTop: 12 }}>*Full demo also available inside the app</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function TrustSafety() {
  const cards = [
    { icon: "🛡️", title: "Identity Verification", desc: "We offer all users the option to verify their identity through a government ID check. Verified users build more trust on the platform and help keep the community safe for everyone." },
    { icon: "📄", title: "Digital Contracts", desc: "Legally binding rental agreements are signed in the app before every rental." },
    { icon: "🔔", title: "Activity & Notifications", desc: "Stay updated on every rental request, contract signature, and message — all in one place." },
  ];
  return (
    <section style={styles.section} id="trust">
      <div style={styles.container}>
        <h2 style={styles.sectionTitle}>Trust &amp; Safety</h2>
        <p style={styles.sectionSub}>We've built the infrastructure to make peer-to-peer rentals safe and formal</p>
        <div style={styles.trustGrid}>
          {cards.map(({ icon, title, desc }) => (
            <div key={title} style={styles.trustCard}>
              <div style={styles.trustIcon}>{icon}</div>
              <h4 style={styles.trustH4}>{title}</h4>
              <p style={styles.trustP}>{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Audiences() {
  const scroll = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  return (
    <section style={styles.sectionAlt} id="audiences">
      <div style={styles.container}>
        <div style={styles.contentGrid} className="sl-content-grid">
          <div style={styles.contentCard}>
            <h3 style={styles.contentH3}>🚗 Owners: Earn Passive Income</h3>
            <p style={styles.contentP}>Your car, scooter, or bike sits idle most of the day. Put it to work and earn weekly income from drivers who need reliable transport.</p>
            <p style={styles.contentP}>You set the price, you approve the driver, and you're protected by a digital contract every time.</p>
            <a href="#how-it-works" style={{ ...styles.btnBase, ...styles.btnOutline, ...styles.btnLarge, marginTop: 12 }}
              onClick={e => { e.preventDefault(); scroll("how-it-works"); }}
              onMouseEnter={e => (e.currentTarget.style.background = "#eff6ff")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
            >Learn More</a>
          </div>
          <div style={styles.contentCard}>
            <h3 style={styles.contentH3}>📦 Drivers: Why Rent, Not Buy</h3>
            <p style={styles.contentP}>Buying a vehicle for gig work is expensive. Renting gives you flexibility—choose from cars, scooters, or bikes, and only pay for the weeks you need.</p>
            <p style={styles.contentP}>All rentals include a formal agreement and access to verified owners.</p>
            <a href="#how-it-works" style={{ ...styles.btnBase, ...styles.btnOutline, ...styles.btnLarge, marginTop: 12 }}
              onClick={e => { e.preventDefault(); scroll("how-it-works"); }}
              onMouseEnter={e => (e.currentTarget.style.background = "#eff6ff")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
            >Learn More</a>
          </div>
        </div>
      </div>
    </section>
  );
}

function About() {
  return (
    <section style={styles.sectionAlt} id="about">
      <div style={{ ...styles.container, textAlign: "center", maxWidth: 800, margin: "0 auto" }}>
        <h2 style={styles.sectionTitle}>About Skootlink</h2>
        {[
          "Skootlink was born from a simple observation: delivery drivers and other gig workers struggle to access affordable vehicles, and vehicle owners have no secure way to rent them out. The industry runs on informal, word-of-mouth arrangements with no contracts, no protection, and no trust.",
          "We built Skootlink to change that. A formal, digital platform that connects verified owners with verified drivers, backed by legal contracts. Whether it's a car, scooter, or motorbike, we're making vehicle rental safe, transparent, and profitable for everyone.",
          "Skootlink is a registered South African company, committed to building trust in the gig economy.",
        ].map((text, i) => (
          <p key={i} style={{ fontSize: 18, color: "#71717a", marginBottom: 24 }}>{text}</p>
        ))}
      </div>
    </section>
  );
}

function DownloadCTA() {
  return (
    <section style={styles.ctaSection} id="download">
      <div style={styles.container}>
        <h2 style={styles.ctaH2}>Ready to Get Started?</h2>
        <p style={styles.ctaP}>Join Skootlink and be part of the formal vehicle rental revolution in South Africa.</p>
        <div style={styles.heroBtns}>
          <button style={styles.ctaBtnWhite} onClick={openAuth}
            onMouseEnter={e => (e.currentTarget.style.opacity = "0.9")}
            onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
          >🚀 Create an Account</button>
          <button style={styles.ctaBtnGhost} onClick={openAuth}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.1)")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
          >🔑 Sign In</button>
        </div>
      </div>
    </section>
  );
}

function Contact() {
  const [form, setForm] = useState({ name: "", email: "", message: "" });
  const [sent, setSent] = useState(false);
  const handleSubmit = (e) => { e.preventDefault(); setSent(true); setForm({ name: "", email: "", message: "" }); };
  return (
    <section style={styles.section} id="contact">
      <div style={{ ...styles.container, maxWidth: 600, margin: "0 auto" }}>
        <h2 style={styles.sectionTitle}>Contact Us</h2>
        <p style={styles.sectionSub}>Have questions? We'd love to hear from you.</p>
        {sent ? (
          <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 12, padding: "24px", textAlign: "center", color: "#16a34a", fontWeight: 600, fontSize: 16 }}>
            ✅ Message sent! We'll get back to you shortly.
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <input type="text" placeholder="Your Name" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={styles.formInput} />
            <input type="email" placeholder="Your Email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} style={styles.formInput} />
            <textarea rows={5} placeholder="Your Message" required value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} style={styles.formTextarea} />
            <button type="submit" style={{ ...styles.btnBase, ...styles.btnPrimary, width: "100%", textAlign: "center" }}
              onMouseEnter={e => (e.currentTarget.style.background = PRIMARY_DARK)}
              onMouseLeave={e => (e.currentTarget.style.background = PRIMARY)}
            >Send Message</button>
          </form>
        )}
        <p style={{ textAlign: "center", marginTop: 24, color: "#71717a" }}>
          📧 help@skootlink.co.za<br />
          📱 Available on Google Play and App Store
        </p>
      </div>
    </section>
  );
}

function Footer() {
  const scroll = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  return (
    <footer style={styles.footer}>
      <div style={styles.container}>
        <div style={styles.footerGrid}>
          <div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <img src="/favicon.png" alt="Skootlink" style={{ height: 40, width: "auto" }} />
                <span style={{ fontSize: 20, fontWeight: 700, color: "#fff", letterSpacing: "-0.025em", fontFamily: "inherit" }}>Skootlink</span>
              </div>
            </div>
            <p style={{ color: "rgba(255,255,255,0.7)", fontSize: 14 }}>The formal way to rent vehicles for gig work in South Africa.</p>
          </div>
          <div>
            <h4 style={styles.footerH4}>Platform</h4>
            {[["How It Works", "how-it-works"], ["Trust & Safety", "trust"], ["About", "about"]].map(([label, id]) => (
              <a key={id} href={`#${id}`} style={styles.footerLink}
                onClick={e => { e.preventDefault(); scroll(id); }}
                onMouseEnter={e => (e.currentTarget.style.color = "#fff")}
                onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.7)")}
              >{label}</a>
            ))}
          </div>
          <div>
            <h4 style={styles.footerH4}>Company</h4>
            {[["Contact Us", "contact"]].map(([label, id]) => (
              <a key={id} href={`#${id}`} style={styles.footerLink}
                onClick={e => { e.preventDefault(); scroll(id); }}
                onMouseEnter={e => (e.currentTarget.style.color = "#fff")}
                onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.7)")}
              >{label}</a>
            ))}
            <a href="#" style={styles.footerLink} onMouseEnter={e => (e.currentTarget.style.color = "#fff")} onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.7)")}>Blog</a>
          </div>
          <div>
            <h4 style={styles.footerH4}>Legal</h4>
            <a href="/Privacy_Policy.html" target="_blank" rel="noopener noreferrer" style={styles.footerLink} onMouseEnter={e => (e.currentTarget.style.color = "#fff")} onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.7)")}>Privacy Policy</a>
            <a href="/Terms_and_Conditions.html" target="_blank" rel="noopener noreferrer" style={styles.footerLink} onMouseEnter={e => (e.currentTarget.style.color = "#fff")} onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.7)")}>Terms of Service</a>
          </div>
        </div>
        <div style={styles.footerBottom}>© 2026 Skootlink (Pty) Ltd. All rights reserved. Built in South Africa 🇿🇦</div>
      </div>
    </footer>
  );
}

export default function LandingPage() {
  // Redirect authenticated users straight to the app —
  // handles the case where Google OAuth sends them back to /
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) window.location.replace('/home');
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session) {
        window.location.replace('/home');
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  return (
    <div style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", color: "#09090b", lineHeight: 1.6, overflowX: "hidden", background: "#fff" }}>
      <style>{demoCSS}</style>
      <Navbar />
      <Hero />
      <HowItWorks />
      <DemoSection />
      <TrustSafety />
      <Audiences />
      <About />
      <DownloadCTA />
      <Contact />
      <Footer />
    </div>
  );
}
