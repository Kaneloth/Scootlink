import { useState, useEffect, useRef } from "react";
import { supabase } from '@/api/supabaseClient';

const openAuth = () => window.open("/auth", "_blank", "noopener,noreferrer");

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
  galleryGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 24 },
  galleryCard: { borderRadius: 20, overflow: "hidden", border: "1px solid #e4e4e7", background: "#fff", transition: "transform .2s, box-shadow .2s" },
  galleryImg: { aspectRatio: "9 / 16", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 56 },
  galleryLabel: { padding: "16px 18px" },
  galleryH4: { fontSize: 16, marginBottom: 2 },
  galleryP: { color: "#71717a", fontSize: 13 },
  faqList: { maxWidth: 760, margin: "0 auto" },
  faqCategoryTitle: { fontSize: 20, fontWeight: 700, color: PRIMARY, margin: "40px 0 12px" },
  faqItem: { borderBottom: "1px solid #e4e4e7" },
  faqQuestion: { width: "100%", textAlign: "left", background: "none", border: "none", padding: "22px 4px", fontSize: 17, fontWeight: 600, color: "#09090b", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, fontFamily: "inherit" },
  faqAnswer: { padding: "0 4px 22px", color: "#71717a", fontSize: 15, lineHeight: 1.7 },
  faqList2: { paddingLeft: 22, marginTop: 8 },
  faqIcon: { fontSize: 20, color: PRIMARY, flexShrink: 0, transition: "transform .2s" },
  faqStillNeedHelp: { textAlign: "center", marginTop: 20 },
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
          {[["How It Works", "how-it-works"], ["Gallery", "gallery"], ["Trust & Safety", "trust"], ["FAQ", "faq"], ["About", "about"], ["Contact", "contact"]].map(([label, id]) => (
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

function GalleryImage({ src, emoji }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div style={{ ...styles.galleryImg, background: "linear-gradient(135deg,#eff6ff,#dbeafe)" }}>
        <span style={{ opacity: 0.5 }}>{emoji}</span>
      </div>
    );
  }
  return (
    <div style={{ width: "100%", aspectRatio: "9 / 16", background: "#f4f4f5", overflow: "hidden" }}>
      <img
        src={src}
        alt=""
        style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
        onError={() => setFailed(true)}
      />
    </div>
  );
}

function DemoSection() {
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const touchStartX = useRef(null);

  const galleryItems = [
    { src: "/gallery/dashboard.png", emoji: "🏠", label: "Your Command Centre", desc: "See active rentals, vehicle stats, and quick actions at a glance." },
    { src: "/gallery/search.png",    emoji: "🔍", label: "Find the Right Vehicle", desc: "Filter by type, price, and location. Browse cars, scooters, vans, and more." },
    { src: "/gallery/find-drivers.png", emoji: "🧑‍✈️", label: "Find the Right Driver", desc: "Owners can browse verified drivers, check ratings and platform history, and send a rental offer directly." },
    { src: "/gallery/contract.png",  emoji: "📄", label: "Sign Digital Contracts", desc: "Legally binding agreements signed inside the app. No paperwork needed." },
    { src: "/gallery/verified.png",  emoji: "🛡️", label: "Build Trust with Verification", desc: "Optional ID and licence checks give you a verified badge. Stand out from the crowd." },
    { src: "/gallery/chat.png",      emoji: "💬", label: "Chat Securely", desc: "Message owners and drivers inside the app. Contact details stay hidden until a contract is signed." },
    { src: "/gallery/briefcase.png", emoji: "💼", label: "Your Digital Briefcase", desc: "All your contracts and rental history stored safely. Download PDFs anytime." },
  ];

  const showNext = () => setLightboxIndex(i => (i === null ? null : (i + 1) % galleryItems.length));
  const showPrev = () => setLightboxIndex(i => (i === null ? null : (i - 1 + galleryItems.length) % galleryItems.length));
  const handleTouchStart = (e) => { touchStartX.current = e.touches[0].clientX; };
  const handleTouchEnd = (e) => {
    if (touchStartX.current === null) return;
    const delta = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(delta) > 50) { delta < 0 ? showNext() : showPrev(); }
    touchStartX.current = null;
  };

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
              <li>🔍 Finding a vehicle near you</li>
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
          </div>
        </div>

        {/* Screenshot gallery — merged into this same section, not a separate one, to avoid a duplicate "See Skootlink in Action" heading */}
        <div id="gallery" style={{ marginTop: 80 }}>
          <div style={styles.galleryGrid}>
            {galleryItems.map(({ src, emoji, label, desc }, i) => (
              <div
                key={label}
                style={{ ...styles.galleryCard, cursor: "pointer" }}
                onClick={() => setLightboxIndex(i)}
                onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-4px)"; e.currentTarget.style.boxShadow = "0 12px 24px -8px rgba(37,99,235,.2)"; }}
                onMouseLeave={e => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "none"; }}
              >
                <GalleryImage src={src} emoji={emoji} />
                <div style={styles.galleryLabel}>
                  <h4 style={styles.galleryH4}>{label}</h4>
                  <p style={styles.galleryP}>{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {lightboxIndex !== null && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 100000, background: "rgba(0,0,0,0.92)",
            display: "flex", flexDirection: "column",
          }}
          onClick={() => setLightboxIndex(null)}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", color: "#fff", flexShrink: 0 }}>
            <div>
              <p style={{ fontWeight: 700, fontSize: 15 }}>{galleryItems[lightboxIndex].label}</p>
              <p style={{ fontSize: 12, opacity: 0.7 }}>{lightboxIndex + 1} of {galleryItems.length}</p>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); setLightboxIndex(null); }}
              style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(255,255,255,0.1)", border: "none", color: "#fff", fontSize: 20, cursor: "pointer" }}
            >
              ✕
            </button>
          </div>

          <div
            style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", position: "relative", padding: "0 16px 16px" }}
            onClick={e => e.stopPropagation()}
          >
            <button
              onClick={showPrev}
              style={{ position: "absolute", left: 12, width: 44, height: 44, borderRadius: "50%", background: "rgba(255,255,255,0.1)", border: "none", color: "#fff", fontSize: 22, cursor: "pointer" }}
            >
              ‹
            </button>
            <img
              src={galleryItems[lightboxIndex].src}
              alt=""
              style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 12, userSelect: "none" }}
              onError={e => { e.currentTarget.style.display = "none"; }}
            />
            <button
              onClick={showNext}
              style={{ position: "absolute", right: 12, width: 44, height: 44, borderRadius: "50%", background: "rgba(255,255,255,0.1)", border: "none", color: "#fff", fontSize: 22, cursor: "pointer" }}
            >
              ›
            </button>
          </div>

          <p style={{ textAlign: "center", color: "rgba(255,255,255,0.5)", fontSize: 12, paddingBottom: 12 }}>
            Swipe or use the arrows to browse other screens
          </p>
        </div>
      )}
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

function FAQ() {
  const categories = [
    {
      title: "General",
      items: [
        { q: "What is Skootlink?", a: "Skootlink is a digital platform that connects independent vehicle owners with gig-economy drivers who need temporary access to cars, scooters, vans, and motorbikes. We provide a safe, formal way to rent vehicles with digital contracts, optional identity verification, and communication tools built into the app." },
        { q: "Is Skootlink free to use?", a: "Yes. Registering an account on Skootlink is completely free. All new users receive a generous amount of free sign-up credits so they can start browsing, chatting, listing vehicles, and signing rental contracts straight away. There are no monthly subscriptions or hidden fees to get started." },
        { q: "Who can use Skootlink?", a: <>Anyone over 18 with a valid email address or phone number can register. You can join as a <strong>Driver</strong> (looking to rent a vehicle for delivery or transport work) or an <strong>Owner</strong> (listing your vehicle to earn extra income).</> },
        { q: "Do I need a South African ID to use Skootlink?", a: "No. You can register and use the platform with just an email address. Identity verification is completely optional and gives you a verified badge on your profile." },
        { q: "Is Skootlink available on Android and iPhone?", a: "Yes. Skootlink works on any modern web browser on your phone, tablet, or computer. We are also available on the Google Play Store as an Android app, and an iOS version is coming soon." },
      ],
    },
    {
      title: "For Drivers",
      items: [
        { q: "How do I find a vehicle to rent?", a: <>Tap the <strong>Search</strong> tab at the bottom of the app. You'll see vehicles available near you. You can filter by type (car, scooter, motorbike, van), location, and price. When you find one you like, send a message to the owner to start the rental process.</> },
        { q: "How does the rental process work?", a: (
          <ol style={styles.faqList2}>
            <li>Find a vehicle and send a rental proposal to the owner.</li>
            <li>The owner reviews your profile and accepts or declines.</li>
            <li>Both parties sign a digital rental contract through the app.</li>
            <li>You pick up the vehicle and start delivering.</li>
            <li>Return the vehicle at the agreed time.</li>
          </ol>
        ) },
        { q: "What happens if I damage the vehicle?", a: "The rental contract you sign with the owner specifies liability and deposit terms. Skootlink provides a formal contract that protects both parties, but damage disputes are resolved between the driver and owner. We encourage owners to have insurance and to photograph the vehicle before and after each rental." },
      ],
    },
    {
      title: "For Owners",
      items: [
        { q: "How do I list my vehicle?", a: <>Tap <strong>Add Vehicle</strong> from the Dashboard or Briefcase tab. Upload photos, enter the make, model, year, registration number, location, and your weekly price. Once published, drivers can find it in the search results.</> },
        { q: "How do I approve a driver?", a: <>When a driver sends a rental proposal, you'll see it in your Dashboard under <strong>Pending Proposals</strong>. You can view the driver's profile, including any verification badges, and choose to accept or decline. If accepted, a digital contract is generated for both parties to sign.</> },
        { q: "What if a driver doesn't return my vehicle on time?", a: "The digital contract includes start and end dates. If a driver is late, the contract terms apply. We recommend discussing any delays directly with the driver via in-app messaging. For repeated issues, you can block the driver from renting your vehicles in the future." },
        { q: "Do I need insurance?", a: "Yes. You must have valid motor insurance appropriate for rental use. Skootlink does not provide insurance; it is your responsibility to ensure your vehicle is covered while rented out." },
      ],
    },
    {
      title: "Trust & Safety",
      items: [
        { q: "How does Skootlink keep me safe?", a: (
          <>
            We've built several safety features:
            <ul style={styles.faqList2}>
              <li><strong>Digital contracts</strong> — Legally binding agreements signed in the app.</li>
              <li><strong>Optional verification badges</strong> — Identity and licence checks for users who want to build trust.</li>
              <li><strong>In-app messaging</strong> — No need to share your phone number until a contract is signed.</li>
              <li><strong>Ratings &amp; reviews</strong> — Honest feedback helps everyone make informed decisions.</li>
            </ul>
          </>
        ) },
        { q: "What is a Verified badge?", a: "Users who choose to verify their identity or driving licence through our third-party provider get a badge on their profile (✅ ID Verified or 🛡️ Fully Verified). This lets others know their details have been checked. Verification is optional and does not guarantee a person's trustworthiness, but it's a strong signal of good faith." },
        { q: "Can I block or report another user?", a: "Yes. You can report inappropriate behaviour through the app, and you can block a user from contacting you or renting your vehicle. Skootlink can also suspend or ban users who violate our Terms of Service." },
      ],
    },
    {
      title: "Account & Profile",
      items: [
        { q: "How do I change my password?", a: <>Go to <strong>Settings</strong> → <strong>Security</strong> → <strong>Change Password</strong>. Enter your current password and a new one.</> },
        { q: "How do I delete my account?", a: <>Go to <strong>Settings</strong> → <strong>Security</strong> → <strong>Delete Account</strong>. You'll need to confirm your identity and type "DELETE" to finalise. This permanently removes your profile, listings, and rental history.</> },
        { q: "Can I switch between Driver and Owner?", a: <>Yes. You can switch your role at any time from your <strong>Profile</strong> page.</> },
      ],
    },
    {
      title: "Contracts & Briefcase",
      items: [
        { q: "What is a digital contract?", a: "It's a legally binding rental agreement between you and the other party, generated and signed inside the Skootlink app. It outlines the vehicle, rental dates, weekly rate, deposit, and responsibilities of both parties." },
        { q: "Can I download my contracts?", a: <>Yes. All signed contracts are stored in your <strong>Briefcase</strong> tab. You can download them as PDF files at any time.</> },
        { q: "What happens if I lose a signed contract?", a: "Your contracts are stored securely in your Briefcase and can be re-downloaded at any time. You'll never lose access to them while your account is active." },
      ],
    },
  ];
  const [openKey, setOpenKey] = useState(null);

  return (
    <section style={styles.section} id="faq">
      <div style={styles.container}>
        <h2 style={styles.sectionTitle}>Frequently Asked Questions</h2>
        <p style={styles.sectionSub}>Everything you need to know about Skootlink — the formal way to rent vehicles for gig work</p>
        <div style={styles.faqList}>
          {categories.map(({ title, items }) => (
            <div key={title}>
              <h3 style={styles.faqCategoryTitle}>{title}</h3>
              {items.map(({ q, a }) => {
                const key = `${title}-${q}`;
                const isOpen = openKey === key;
                return (
                  <div key={key} style={styles.faqItem}>
                    <button
                      style={styles.faqQuestion}
                      onClick={() => setOpenKey(isOpen ? null : key)}
                      aria-expanded={isOpen}
                    >
                      {q}
                      <span style={{ ...styles.faqIcon, transform: isOpen ? "rotate(45deg)" : "none" }}>+</span>
                    </button>
                    {isOpen && <div style={styles.faqAnswer}>{a}</div>}
                  </div>
                );
              })}
            </div>
          ))}

          <div style={styles.faqStillNeedHelp}>
            <h3 style={styles.faqCategoryTitle}>Still need help?</h3>
            <p style={{ color: "#71717a", fontSize: 15 }}>
              Can't find what you're looking for?{" "}
              <a
                href="#contact"
                style={{ color: PRIMARY, cursor: "pointer" }}
                onClick={e => { e.preventDefault(); document.getElementById("contact")?.scrollIntoView({ behavior: "smooth" }); }}
              >
                Contact us below
              </a>.
            </p>
          </div>
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
          📧 <a href="mailto:help@skootlink.co.za" style={{ color: PRIMARY }}>help@skootlink.co.za</a><br />
          We aim to respond within 24 hours on business days.
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
            <a href="/blog" style={styles.footerLink} onMouseEnter={e => (e.currentTarget.style.color = "#fff")} onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.7)")}>Blog</a>
          </div>
          <div>
            <h4 style={styles.footerH4}>Legal</h4>
            {["Privacy Policy", "Terms of Service", "POPIA Compliance"].map(label => (
              <a key={label} href="#" style={styles.footerLink} onMouseEnter={e => (e.currentTarget.style.color = "#fff")} onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.7)")}>{label}</a>
            ))}
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
      <FAQ />
      <Contact />
      <Footer />
    </div>
  );
}
