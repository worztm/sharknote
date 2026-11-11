import BackgroundHero from "./BackgroundHero";
import HeroScene from "./HeroScene";
import { useEffect, useState } from "react";

const APP_VERSION = "1.10.5";
const ANDROID_VERSION = "0.4.3";
const INSTALLER_URL = "/sharknote-setup.exe";
const INSTALLER_SHA256 = "3241a99e3b99159a98052297e0903b32808a50ffe0bde3d2475eac7d28e6f145";
const INSTALLER_SIZE = "10.0 MB";
const APK_URL = "/sharknote-android.apk";
const APK_GITHUB_URL =
  "https://github.com/worztm/sharknote/releases/download/v0.4.3-android/sharknote-0.4.3-android-native.apk";
const APK_SHA256 = "e3204b0b022f027317ddfa8fc92550e7d479ece2b1d743744d037ce1d5f1a33f";
const APK_SIZE = "1.6 MB";
const GITHUB_URL = "https://github.com/worztm/sharknote";

/* ---------------------------------- icons --------------------------------- */
const S = 18;
const si = (props) => ({
  viewBox: "0 0 24 24",
  width: S,
  height: S,
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  ...props,
});

const IconArrow = () => (
  <svg {...si({ width: 14, height: 14 })}>
    <path d="M2 8h11M9 3.5 13.5 8 9 12.5" />
  </svg>
);
const IconDownload = () => (
  <svg {...si()}>
    <path d="M12 3v12" />
    <path d="m7 11 5 5 5-5" />
    <path d="M4 19h16" />
  </svg>
);
const IconWindows = () => (
  <svg {...si({ fill: "currentColor", stroke: "none" })}>
    <path d="M3 5.5 10.5 4.4v7.1H3V5.5ZM11.5 4.2 21 3v8.5h-9.5V4.2ZM3 12.5h7.5v7.1L3 18.5v-6ZM11.5 12.5H21V21l-9.5-1.35v-7.15Z" />
  </svg>
);
const IconAndroid = () => (
  <svg {...si()}>
    <path d="M5 10a7 7 0 0 1 14 0v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7Z" />
    <path d="M8.5 3.5 10 6M15.5 3.5 14 6" />
    <circle cx="9.2" cy="10.6" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="14.8" cy="10.6" r="0.9" fill="currentColor" stroke="none" />
    <path d="M3 11v5M21 11v5" />
  </svg>
);
const IconLink = () => (
  <svg {...si()}>
    <path d="M10 14a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11.5 4.5" />
    <path d="M14 10a5 5 0 0 0-7.07 0L4.1 12.83a5 5 0 0 0 7.07 7.07l1.25-1.24" />
  </svg>
);
const IconGraph = () => (
  <svg {...si()}>
    <circle cx="12" cy="4.5" r="2.2" />
    <circle cx="5" cy="18" r="2.2" />
    <circle cx="19" cy="18" r="2.2" />
    <path d="M10.9 6.4 6.1 16.1M13.1 6.4l4.8 9.7M7.2 18h9.6" />
  </svg>
);
const IconSearch = () => (
  <svg {...si()}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </svg>
);
const IconSave = () => (
  <svg {...si()}>
    <path d="M5 3h11l3 3v15H5V3Z" />
    <path d="M8 3v6h8V3" />
    <path d="M8 21v-7h8v7" />
  </svg>
);
const IconFile = () => (
  <svg {...si()}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z" />
    <path d="M14 2v6h6" />
    <path d="M9 13h6M9 17h6" />
  </svg>
);
const IconShield = () => (
  <svg {...si()}>
    <path d="M12 2 4.5 5v6c0 4.4 3.2 8.4 7.5 10 4.3-1.6 7.5-5.6 7.5-10V5L12 2Z" />
    <path d="m9 11.5 2 2 4-4.5" />
  </svg>
);
const IconBolt = () => (
  <svg {...si()}>
    <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />
  </svg>
);
const IconMoon = () => (
  <svg {...si()}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
  </svg>
);
const IconTag = () => (
  <svg {...si()}>
    <path d="M3 10V4.5A1.5 1.5 0 0 1 4.5 3H10l10 10-6 6L3 10Z" />
    <circle cx="7.2" cy="7.2" r="1.3" />
  </svg>
);
const IconGlass = () => (
  <svg {...si()}>
    <path d="M12 3c-4 0-7.5 3.1-8.3 7.2-.3 1.5.6 2.9 2.1 3.4 1.7.6 3.4-.2 4.2-1.8.7-1.4.4-3-1-4" />
    <path d="M12 21c4 0 7.5-3.1 8.3-7.2.3-1.5-.6-2.9-2.1-3.4-1.7-.6-3.4.2-4.2 1.8-.7 1.4-.4 3 1 4" />
    <circle cx="12" cy="12" r="2.2" />
  </svg>
);

/* ---------------------------------- data ---------------------------------- */
const features = [
  {
    icon: IconGlass,
    title: "Liquid Glass interface",
    body: "Clear water, not a coloured wash: the window is genuinely transparent, so your desktop shows through frosted panels with refractive edges and a sheen that sweeps across every control. One switch in Settings.",
  },
  {
    icon: IconLink,
    title: "Bidirectional links",
    body: "Type [[ to link any two notes. Every note shows its backlinks with context, so ideas stay connected without folders or tags.",
  },
  {
    icon: IconGraph,
    title: "Live knowledge graph",
    body: "Your whole vault as a force-directed network. Drag nodes, pinch zoom, tap to open — the graph updates as you write.",
  },
  {
    icon: IconSearch,
    title: "Instant full-text search",
    body: "SQLite FTS5 keeps search instant and relevance-ranked, even across thousands of notes. Finds words, tags, todo titles.",
  },
  {
    icon: IconSave,
    title: "Local-first, autosaved",
    body: "Everything writes to an encrypted local database on your own disk. No login, no sync account, nothing leaves the machine.",
  },
  {
    icon: IconFile,
    title: "Plain Markdown, opens anywhere",
    body: "Import single .md files or whole folders. Associate .md with Sharknote and double-click any file in Explorer to open it.",
  },
  {
    icon: IconMoon,
    title: "Quiet by design",
    body: "Keyboard-first: Ctrl+K command palette, Ctrl+G graph, Ctrl+E preview. No adds, no onboarding gates, no interruptions.",
  },
];

const stats = [
  { k: "1.10.5", v: "Windows version" },
  { k: "0.4.3", v: "Android version" },
  { k: "0", v: "servers to trust" },
  { k: "MIT", v: "open source" },
];

const faqs = [
  {
    q: "Where do my notes live?",
    a: "On your machine. Windows stores them in your user profile; Android encrypts them at rest with the system keystore. There is no cloud copy, no sync, no account.",
  },
  {
    q: "Does Sharknote need the internet?",
    a: "No. Searching, linking, graphing and todos all work offline. The only network call is the optional update check, which is verified against a signed manifest.",
  },
  {
    q: "Why did SmartScreen / Play Protect warn me?",
    a: "New open source apps take time to earn reputation with Google and Microsoft. Check the SHA-256 fingerprints below, then allow the install.",
  },
  {
    q: "Is Sharknote really free?",
    a: "Yes — free and open source. No premium tier, no feature locks, no email required.",
  },
];

/* --------------------------------- reveal --------------------------------- */
function useReveal() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll("[data-reveal]"));
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (en.isIntersecting) {
            en.target.classList.add("in");
            io.unobserve(en.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -48px 0px" }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

/* ---------------------------------- app ----------------------------------- */
export default function App() {
  const [openFaq, setOpenFaq] = useState(-1);
  const [mobileOpen, setMobileOpen] = useState(false);
  useReveal();

  return (
    <div className="page">
      <header className="nav">
        <div className="container nav-inner">
          <a className="brand" href="/">
            <img src="/favicon.png" alt="" height="24" width="24" />
            <span>Sharknote</span>
          </a>
          <nav className={`nav-links ${mobileOpen ? "open" : ""}`}>
            <a href="#features" onClick={() => setMobileOpen(false)}>Features</a>
            <a href="#download" onClick={() => setMobileOpen(false)}>Download</a>
            <a href="#android" onClick={() => setMobileOpen(false)}>Android</a>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
          </nav>
          <div className="nav-actions">
            <a className="btn btn-primary btn-small" href={INSTALLER_URL}>
              <IconWindows />
              <span>Download</span>
            </a>
            <button
              className="menu-toggle"
              aria-expanded={mobileOpen}
              aria-label="Toggle menu"
              onClick={() => setMobileOpen(!mobileOpen)}
            >
              <span className="menu-line" />
              <span className="menu-line" />
            </button>
          </div>
        </div>
        {mobileOpen && (
          <div className="mobile-menu">
            <a href="#features" onClick={() => setMobileOpen(false)}>Features</a>
            <a href="#download" onClick={() => setMobileOpen(false)}>Download</a>
            <a href="#android" onClick={() => setMobileOpen(false)}>Android</a>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a>
          </div>
        )}
      </header>

      <main>
        {/* ------------------------------- hero ------------------------------ */}
        <section className="hero">
          <BackgroundHero />
          <div className="hero-glow" aria-hidden="true" />
          <div className="container hero-inner">
            <a className="hero-badge" data-reveal href="#download">
              <span className="badge-dot" />
              v{APP_VERSION} for Windows · signed updates · now with self-hosted APK
              <IconArrow />
            </a>
            <h1 data-reveal>
              <span>Your notes, linked<br />like a mind.</span>
              <span className="h1-shimmer" aria-hidden="true">
                Your notes, linked<br />like a mind.
              </span>
            </h1>
            <p className="lead" data-reveal>
              Sharknote is a quiet, local-first note app for Windows and Android.
              Type <code className="inline-code">[[</code> to connect any two notes,
              watch your ideas become a graph, and find anything instantly.
              Nothing ever leaves your machine.
            </p>
            <div className="hero-actions" data-reveal>
              <a className="btn btn-primary btn-big" href={INSTALLER_URL}>
                <IconWindows /> Download for Windows <IconArrow />
              </a>
              <a className="btn btn-ghost btn-big" href={APK_URL}>
                <IconAndroid /> Android APK
              </a>
            </div>
            <div className="hero-chips" data-reveal>
              <span className="chip"><IconBolt /> {INSTALLER_SIZE} installer</span>
              <span className="chip"><IconShield /> Signed updates</span>
              <span className="chip"><IconTag /> Free · open source</span>
              <span className="chip"><IconMoon /> No account, no cloud</span>
            </div>
          </div>

          {/* product mockup, pure CSS */}
          <div className="container" data-reveal>
            <div className="mockup-wrap">
              <div className="mockup">
                <div className="mockup-titlebar">
                  <span className="tb-dots"><i /><i /><i /></span>
                  <span className="tb-title">Sharknote</span>
                  <span className="tb-keys">Ctrl K</span>
                </div>
                <div className="mockup-body">
                  <aside className="mockup-side">
                    <div className="side-search">
                      <IconSearch />
                      <span>Search notes…</span>
                    </div>
                    <div className="side-item confidential">
                      <span className="side-star">★</span> Knowledge graphs
                    </div>
                    <div className="side-item">Local-first software</div>
                    <div className="side-item confidential">Zettelkasten notes</div>
                    <div className="side-item">Reading list</div>
                    <div className="side-item">Project Aurora</div>
                    <div className="side-item">Agile note review</div>
                  </aside>
                  <div className="mockup-editor">
                    <div className="ed-title">Knowledge graphs</div>
                    <p className="ed-p">
                      A graph is just a set of things and the links between them.
                      In Sharknote every note is a node, and every{" "}
                      <span className="ed-link">[[Zettelkasten notes]]</span> you
                      type is an edge.
                    </p>
                    <p className="ed-p">
                      The whole point of{" "}
                      <span className="ed-link">[[Local-first software]]</span> is
                      that your data outlives every service you use it with.
                    </p>
                    <div className="ed-backlinks">
                      <span className="bl-label">2 backlinks</span>
                      <span className="bl-chip">Reading list</span>
                      <span className="bl-chip">Project Aurora</span>
                    </div>
                  </div>
                  <div className="mockup-graph">
                    <div className="mg-label">Graph view</div>
                    <svg viewBox="0 0 200 200" aria-hidden="true">
                      <line x1="100" y1="60" x2="55" y2="130" />
                      <line x1="100" y1="60" x2="150" y2="120" />
                      <line x1="55" y1="130" x2="150" y2="120" />
                      <line x1="55" y1="130" x2="95" y2="170" />
                      <line x1="150" y1="120" x2="95" y2="170" />
                      <line x1="100" y1="60" x2="128" y2="28" />
                      <circle cx="100" cy="60" r="9" className="gn hub" />
                      <circle cx="55" cy="130" r="7" className="gn" />
                      <circle cx="150" cy="120" r="6" className="gn" />
                      <circle cx="95" cy="170" r="5" className="gn" />
                      <circle cx="128" cy="28" r="4" className="gn" />
                    </svg>
                  </div>
                </div>
              </div>
              <div className="mockup-float mf-left"><IconLink /> 2 backlinks</div>
              <div className="mockup-float mf-right"><IconGraph /> 1,204 nodes</div>
            </div>
          </div>
        </section>

        {/* ----------------------------- features ---------------------------- */}
        <section className="section" id="features">
          <div className="container">
            <div className="section-head-center" data-reveal>
              <p className="kicker">Everything it should do</p>
              <h2>Built like a note tool.<br />Not like a subscription.</h2>
            </div>
            <div className="feature-grid">
              {features.map(({ icon: Icon, title, body }, i) => (
                <article className="fcard" data-reveal key={title} style={{ transitionDelay: `${(i % 3) * 0.08}s` }}>
                  <span className="fcard-icon"><Icon /></span>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </article>
              ))}
            </div>
            <div className="stats-row" data-reveal>
              {stats.map((s) => (
                <div className="stat" key={s.v}>
                  <span className="stat-k">{s.k}</span>
                  <span className="stat-v">{s.v}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ----------------------------- download ---------------------------- */}
        <section className="section" id="download">
          <div className="container">
            <div className="section-head-center" data-reveal>
              <p className="kicker">Download</p>
              <h2>Grab it. Own it.<br />Never sign up for it.</h2>
            </div>
            <div className="download-grid">
              <article className="dl-card" data-reveal>
                <div className="dl-head">
                  <span className="dl-icon"><IconWindows /></span>
                  <div>
                    <h3>Sharknote for Windows</h3>
                    <p className="dl-sub">NSIS installer · Windows 10 &amp; 11 · x64</p>
                  </div>
                  <span className="dl-ver">v{APP_VERSION}</span>
                </div>
                <ul className="dl-meta">
                  <li><IconBolt /> {INSTALLER_SIZE} download</li>
                  <li><IconShield /> SHA-256 pinned in the app&apos;s auto-updater</li>
                  <li><IconTag /> Installs per-user, notes never touched</li>
                </ul>
                <a className="btn btn-primary btn-big dl-btn" href={INSTALLER_URL}>
                  <IconDownload /> Download .exe
                </a>
                <div className="dl-hash">
                  <span className="hash-label">SHA-256</span>
                  <code>{INSTALLER_SHA256}</code>
                </div>
              </article>

              <article className="dl-card" data-reveal style={{ transitionDelay: "0.08s" }}>
                <div className="dl-head">
                  <span className="dl-icon android"><IconAndroid /></span>
                  <div>
                    <h3>Sharknote for Android</h3>
                    <p className="dl-sub">Native Kotlin APK · Android 7.0+ · no Play Store needed</p>
                  </div>
                  <span className="dl-ver">v{ANDROID_VERSION}</span>
                </div>
                <ul className="dl-meta">
                  <li><IconBolt /> {APK_SIZE} APK, permission-free install</li>
                  <li><IconShield /> Encrypted at rest with the Android keystore</li>
                  <li><IconTag /> Served from this site, mirrored on GitHub</li>
                </ul>
                <a className="btn btn-ghost btn-big dl-btn" href={APK_URL}>
                  <IconDownload /> Download .apk
                </a>
                <div className="dl-hash">
                  <span className="hash-label">SHA-256</span>
                  <code>{APK_SHA256}</code>
                </div>
              </article>
            </div>
            <p className="trust-foot" data-reveal>
              Both hashes are printed right in the app too. Desktop updates are signed:
              the app verifies every update manifest against a maintainer key, so a
              compromised website alone can never push a malicious update.
            </p>
          </div>
        </section>

        {/* ----------------------------- android ----------------------------- */}
        <section className="section" id="android">
          <div className="container split">
            <div className="split-copy" data-reveal>
              <p className="kicker">Android · v{ANDROID_VERSION}</p>
              <h2>Native, tiny,<br />permission-free.</h2>
              <p className="split-body">
                Sharknote for Android is a real Kotlin and Jetpack Compose app, not a
                webview wrapper. It starts instantly, encrypts notes at rest with the
                Android keystore, and asks for zero risky permissions.
              </p>
              <ul className="checklist">
                <li data-reveal><IconShield /> Notes with autosave, starring and search</li>
                <li data-reveal style={{ transitionDelay: "0.06s" }}><IconBolt /> Todo reminders with real alarms and snooze</li>
                <li data-reveal style={{ transitionDelay: "0.12s" }}><IconFile /> Attach photos and videos straight into a note</li>
                <li data-reveal style={{ transitionDelay: "0.18s" }}><IconGraph /> Live graph: drag nodes, pinch zoom, tap to open</li>
              </ul>
              <div className="hero-actions tight" data-reveal>
                <a className="btn btn-primary" href={APK_URL}>
                  <IconDownload /> Download APK
                </a>
                <a className="btn btn-ghost" href={`${GITHUB_URL}/releases`} target="_blank" rel="noreferrer">
                  Release notes
                </a>
              </div>
            </div>
            <div className="phone-wrap" data-reveal aria-hidden="true">
              <div className="phone">
                <div className="phone-notch" />
                <div className="phone-screen">
                  <div className="ph-head">Graph</div>
                  <svg viewBox="0 0 160 220" className="ph-graph">
                    <line x1="80" y1="70" x2="40" y2="140" />
                    <line x1="80" y1="70" x2="120" y2="130" />
                    <line x1="40" y1="140" x2="120" y2="130" />
                    <line x1="80" y1="70" x2="118" y2="42" />
                    <circle cx="80" cy="70" r="8" className="gn hub" />
                    <circle cx="40" cy="140" r="6" className="gn" />
                    <circle cx="120" cy="130" r="6" className="gn" />
                    <circle cx="118" cy="42" r="5" className="gn" />
                  </svg>
                  <div className="ph-tabs">
                    <span aria-label="Notes">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z" /><path d="M14 2v6h6" /></svg>
                    </span>
                    <span className="ph-tab-active" aria-label="Graph">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="5" r="2.4" /><circle cx="5" cy="18" r="2.4" /><circle cx="19" cy="18" r="2.4" /><path d="M10.8 7 6.2 15.8M13.2 7l4.6 8.8M7.4 18h9.2" /></svg>
                    </span>
                    <span aria-label="Settings">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="12" r="3.2" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V23a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.1-1.55 1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1.1 1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.55 1H23a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1Z" /></svg>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* --------------------------- trust + faq --------------------------- */}
        <section className="section" id="trust">
          <div className="container">
            <div className="section-head-center" data-reveal>
              <p className="kicker">Trust, but verify</p>
              <h2>Every file has a fingerprint.</h2>
            </div>
            <div className="trust-grid">
              <div className="fcard" data-reveal>
                <span className="fcard-icon"><IconWindows /></span>
                <h3>Windows installer</h3>
                <p className="small">
                  New apps get flagged by SmartScreen until they earn reputation.
                  Click <kbd>More info</kbd> → <kbd>Run anyway</kbd>. To verify:
                </p>
                <div className="code-line">certutil -hashfile sharknote-setup.exe SHA256</div>
                <div className="hash">
                  <span className="hash-label">SHA-256</span>
                  <code>{INSTALLER_SHA256}</code>
                </div>
              </div>
              <div className="fcard" data-reveal style={{ transitionDelay: "0.08s" }}>
                <span className="fcard-icon"><IconAndroid /></span>
                <h3>Android APK</h3>
                <p className="small">
                  If Play Protect warns, tap <kbd>More details</kbd> →{" "}
                  <kbd>Install anyway</kbd>. The app asks for notification and reminder
                  permissions only; it reads no files, no contacts, no location, and
                  never talks to a server.
                </p>
                <div className="code-line">sha256sum sharknote-{ANDROID_VERSION}-android-native.apk</div>
                <div className="hash">
                  <span className="hash-label">SHA-256</span>
                  <code>{APK_SHA256}</code>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="section" id="faq">
          <div className="container faq-wrap">
            <div className="section-head-center" data-reveal>
              <p className="kicker">Questions</p>
              <h2>Short answers, no fluff.</h2>
            </div>
            <div className="faq-list" data-reveal>
              {faqs.map((f, i) => (
                <button
                  key={f.q}
                  className={`faq-item ${openFaq === i ? "open" : ""}`}
                  onClick={() => setOpenFaq(openFaq === i ? -1 : i)}
                  aria-expanded={openFaq === i}
                >
                  <span className="faq-q">{f.q}</span>
                  <span className="faq-icon" aria-hidden="true"><IconArrow /></span>
                  <span className="faq-a">{f.a}</span>
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------- final ----------------------------- */}
        <section className="final">
          <div className="final-scene" aria-hidden="true"><HeroScene /></div>
          <div className="container" data-reveal>
            <h2 className="final-title">Ready to think in graphs?</h2>
            <p className="final-body">Free forever. No account, no cloud, no tracking.</p>
            <div className="hero-actions center">
              <a className="btn btn-primary btn-big" href={INSTALLER_URL}>
                Download for Windows <IconArrow />
              </a>
              <a className="btn btn-ghost btn-big" href={APK_URL}>
                Get the Android APK
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="container footer-inner">
          <div className="footer-brand" data-reveal>
            <img src="/favicon.png" alt="" height="20" width="20" />
            <span>Sharknote</span>
          </div>
          <p className="footer-note" data-reveal style={{ transitionDelay: "0.06s" }}>
            v{APP_VERSION} Windows · v{ANDROID_VERSION} Android. Built with Go, React,
            SQLite, Kotlin, Jetpack Compose and three.js.
          </p>
          <a className="footer-link" data-reveal style={{ transitionDelay: "0.12s" }} href={GITHUB_URL} target="_blank" rel="noreferrer">
            GitHub <IconArrow />
          </a>
        </div>
      </footer>
    </div>
  );
}
