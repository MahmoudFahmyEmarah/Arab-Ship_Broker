"use client";

import * as React from "react";
import Link from "next/link";

// The "Coming soon" card shown over a locked (beta) page. Three maritime variants
// — radar (a ship under a radar sweep), beacon (a lighthouse casting a beam) and
// compass (a spinning compass over a plotted sea chart) — chosen by the gate so
// consecutive pages rotate. Navy/brass aesthetic, table-free, all inline so it
// needs no global CSS beyond the keyframes in beta-gate.css.

export type ComingSoonVariant = "radar" | "beacon" | "compass";

const COPY: Record<
  ComingSoonVariant,
  { eyebrow: string; title: string; body: string; trailer?: string }
> = {
  radar: {
    eyebrow: "⚓ COMING SOON",
    title: "Still Charting These Waters",
    body: "This berth isn't open yet — we're fitting it out and running sea trials. It'll be ready for boarding soon. For now, your Dashboard is fully underway.",
  },
  beacon: {
    eyebrow: "🚨 COMING SOON",
    title: "We'll Light the Way Soon",
    body: "This feature is still dark — our keepers are getting the lamp lit. The moment it's burning, you'll see it from a mile off. Your Dashboard stays in clear water.",
  },
  compass: {
    eyebrow: "🧭 COMING SOON",
    title: "Plotting the Course",
    body: "We're laying out the waypoints for this feature. Once the course is set, we'll bring you aboard. Until then, your Dashboard is the steady helm.",
  },
};

/* ---- shared waves (two tiled layers) -------------------------------------- */
function Waves() {
  return (
    <>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 16, height: 30, overflow: "hidden" }}>
        <div style={{ position: "absolute", bottom: 0, left: 0, width: "200%", height: 30, animation: "asbWaveB 11s linear infinite" }}>
          <svg width="100%" height="30" viewBox="0 0 1200 30" preserveAspectRatio="none">
            <path d="M0 16 C 100 6, 200 6, 300 16 S 500 26, 600 16 S 800 6, 900 16 S 1100 26, 1200 16 V30 H0 Z" fill="rgba(36,86,166,0.30)" />
          </svg>
        </div>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 5, height: 30, overflow: "hidden" }}>
        <div style={{ position: "absolute", bottom: 0, left: 0, width: "200%", height: 30, animation: "asbWaveA 7.5s linear infinite" }}>
          <svg width="100%" height="30" viewBox="0 0 1200 30" preserveAspectRatio="none">
            <path d="M0 18 C 120 7, 240 7, 360 18 S 600 28, 720 18 S 960 7, 1080 18 S 1320 28, 1440 18 V30 H0 Z" fill="rgba(47,157,94,0.22)" />
          </svg>
        </div>
      </div>
    </>
  );
}

function SceneShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        position: "relative",
        height: 176,
        overflow: "hidden",
        background: "linear-gradient(180deg,#0d2138 0%,#0a1a2f 62%,#091627 100%)",
      }}
    >
      {/* faint bathymetric grid */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
        }}
      />
      {children}
      <Waves />
    </div>
  );
}

/* ---- radar scene ---------------------------------------------------------- */
function RadarScene() {
  return (
    <SceneShell>
      {/* radar sweep emblem */}
      <div style={{ position: "absolute", right: 20, top: 18, width: 66, height: 66, borderRadius: "50%", border: "1px solid rgba(198,151,73,0.32)" }}>
        <div style={{ position: "absolute", inset: 12, borderRadius: "50%", border: "1px solid rgba(198,151,73,0.22)" }} />
        <div style={{ position: "absolute", left: "50%", top: "50%", width: 5, height: 5, margin: -2.5, borderRadius: "50%", background: "#c69749", boxShadow: "0 0 8px #c69749" }} />
        <div style={{ position: "absolute", left: "50%", top: "50%", width: 31, height: 2, marginTop: -1, background: "linear-gradient(90deg, rgba(198,151,73,0.95), rgba(198,151,73,0))", transformOrigin: "left center", animation: "asbSweep 3.4s linear infinite" }} />
      </div>

      {/* sonar pulse at a port marker */}
      <div style={{ position: "absolute", left: 56, top: 92 }}>
        <div style={{ position: "absolute", width: 32, height: 32, margin: -16, borderRadius: "50%", border: "1.5px solid #c69749", animation: "asbPulse 2.8s cubic-bezier(0.2,0.7,0.2,1) infinite" }} />
        <div style={{ position: "absolute", width: 32, height: 32, margin: -16, borderRadius: "50%", border: "1.5px solid #c69749", animation: "asbPulse 2.8s cubic-bezier(0.2,0.7,0.2,1) infinite 1.4s" }} />
        <div style={{ position: "absolute", width: 8, height: 8, margin: -4, borderRadius: "50%", background: "#c69749", boxShadow: "0 0 10px rgba(198,151,73,0.8)" }} />
      </div>

      {/* bobbing ship */}
      <div style={{ position: "absolute", left: "50%", top: 70, transform: "translateX(-50%)", animation: "asbBob 4.2s ease-in-out infinite", zIndex: 2 }}>
        <svg width="150" height="74" viewBox="0 0 150 74" fill="none">
          <path d="M14 44 H134 L122 63 H26 Z" fill="#13314f" stroke="#c69749" strokeWidth="1.4" strokeLinejoin="round" />
          <path d="M20 50 H128" stroke="rgba(198,151,73,0.35)" strokeWidth="1" />
          <path d="M30 44 V30 H50 V44 Z" fill="#1b3d5e" stroke="#c69749" strokeWidth="1.2" />
          <rect x="35" y="34" width="5" height="5" fill="#c69749" opacity="0.85" />
          <rect x="43" y="34" width="5" height="5" fill="#c69749" opacity="0.55" />
          <path d="M40 30 V18 M40 22 L58 28" stroke="#c69749" strokeWidth="1.2" strokeLinecap="round" />
          <path d="M60 44 V37 H86 V44 M92 44 V37 H116 V44" stroke="rgba(198,151,73,0.55)" strokeWidth="1.1" fill="none" />
          <path d="M40 18 L34 15 L40 12" stroke="#c69749" strokeWidth="1.1" fill="none" />
        </svg>
      </div>
    </SceneShell>
  );
}

/* ---- beacon scene --------------------------------------------------------- */
const BEACON_STARS: [number, number, number][] = [
  [14,12,1.4],[44,7,1],[72,19,1.2],[104,9,1],[133,17,1.5],[162,6,1],
  [194,21,1.2],[224,11,1.5],[254,5,1],[284,17,1.2],[314,13,1],[344,8,1.5],
  [374,19,1],[404,12,1.2],[434,7,1.5],[22,44,1],[54,37,1.2],[84,51,1],
  [284,47,1],[316,36,1.2],[344,51,1],[374,43,1.5],[420,39,1],[450,49,1.2],
  [28,77,1],[258,71,1.2],[368,79,1],[446,67,1.5],[120,30,1],[200,55,1.2],
];

function BeaconScene() {
  return (
    <SceneShell>
      {/* Stars */}
      {BEACON_STARS.map(([x, y, r], i) => (
        <div
          key={i}
          style={{
            position: "absolute", left: x, top: y,
            width: r * 2, height: r * 2,
            borderRadius: "50%", background: "#fff",
            opacity: 0.3 + (i % 6) * 0.09,
          }}
        />
      ))}

      {/* Sweeping beam from lamp room */}
      <div style={{ position: "absolute", left: "50%", top: 50, marginLeft: 4, zIndex: 1 }}>
        <div
          style={{
            position: "absolute", left: 0, top: -10,
            width: 200, height: 76,
            transformOrigin: "left center",
            animation: "asbBeam 5s ease-in-out infinite",
            background: "linear-gradient(90deg, rgba(255,245,210,0.28), rgba(255,245,210,0))",
            clipPath: "polygon(0 43%, 100% 0, 100% 100%, 0 57%)",
          }}
        />
      </div>

      {/* Red & white striped lighthouse */}
      <div style={{ position: "absolute", left: "50%", top: 14, transform: "translateX(-50%)", zIndex: 2 }}>
        <svg width="72" height="142" viewBox="0 0 72 142" fill="none">
          {/* Island base */}
          <path d="M8 124 Q36 114 64 124 V134 Q36 130 8 134 Z" fill="#13314f" />
          {/* Tower — white body */}
          <path d="M28 52 L23 120 H49 L44 52 Z" fill="#eef0f2" />
          {/* Red stripe bands */}
          <path d="M27.5 64 H44.5" stroke="#cc3333" strokeWidth="9" strokeLinecap="butt" />
          <path d="M26.2 82 H45.8" stroke="#cc3333" strokeWidth="9" strokeLinecap="butt" />
          <path d="M25 100 H47"   stroke="#cc3333" strokeWidth="9" strokeLinecap="butt" />
          {/* Tower outline */}
          <path d="M28 52 L23 120 H49 L44 52 Z" fill="none" stroke="rgba(200,212,224,0.2)" strokeWidth="0.8" />
          {/* Gallery platform */}
          <rect x="20" y="49" width="32" height="4" rx="1.5" fill="#b0b8c2" />
          {/* Lamp room */}
          <rect x="23" y="28" width="26" height="21" fill="#0d2138" stroke="rgba(180,200,224,0.4)" strokeWidth="0.9" />
          <line x1="36" y1="28" x2="36" y2="49" stroke="rgba(180,200,224,0.25)" strokeWidth="0.7" />
          <line x1="23" y1="38" x2="49" y2="38" stroke="rgba(180,200,224,0.25)" strokeWidth="0.7" />
          {/* Glow halos — outer to inner for shine effect */}
          <circle cx="36" cy="38" r="14" fill="rgba(255,235,100,0.08)" style={{ animation: "asbGlow 2.6s ease-in-out infinite" }} />
          <circle cx="36" cy="38" r="10" fill="rgba(255,240,140,0.18)" style={{ animation: "asbGlow 2.6s ease-in-out infinite" }} />
          <circle cx="36" cy="38" r="7.5" fill="rgba(255,248,180,0.55)" style={{ animation: "asbGlow 2.6s ease-in-out infinite" }} />
          {/* Core lamp — bright white-yellow */}
          <circle cx="36" cy="38" r="5" fill="#fff8c0" style={{ animation: "asbGlow 2.6s ease-in-out infinite" }} />
          {/* Roof */}
          <path d="M21 28 L36 13 L51 28 Z" fill="#b0b8c2" stroke="rgba(200,212,224,0.35)" strokeWidth="0.9" />
          {/* Finial */}
          <line x1="36" y1="13" x2="36" y2="7" stroke="#b0b8c2" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="36" cy="5.5" r="2.5" fill="#b0b8c2" />
        </svg>
      </div>
    </SceneShell>
  );
}

/* ---- compass scene (light sea chart + spinning compass rose) -------------- */
function CompassScene() {
  const label = { position: "absolute" as const, font: "700 10px var(--font-inter, sans-serif)" };
  return (
    <div style={{ position: "relative", height: 176, overflow: "hidden", background: "#f3ead4" }}>
      {/* chart grid */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(150,120,60,0.10) 1px, transparent 1px), linear-gradient(90deg, rgba(150,120,60,0.10) 1px, transparent 1px)",
          backgroundSize: "30px 30px",
        }}
      />
      {/* dashed plotted route */}
      <svg width="100%" height="100%" viewBox="0 0 460 176" preserveAspectRatio="none" style={{ position: "absolute", inset: 0 }}>
        <path d="M40 140 Q160 52 250 100 T430 60" fill="none" stroke="#2456a6" strokeWidth="2" strokeDasharray="6 7" opacity="0.7" />
      </svg>
      {/* origin port */}
      <div style={{ position: "absolute", left: 36, top: 136, width: 9, height: 9, margin: -4, borderRadius: "50%", background: "#2f9d5e" }} />
      {/* destination waypoint (pulsing) */}
      <div style={{ position: "absolute", left: 424, top: 60 }}>
        <div style={{ position: "absolute", width: 24, height: 24, margin: -12, borderRadius: "50%", border: "1.5px solid #c69749", animation: "asbPulse 2.6s cubic-bezier(0.2,0.7,0.2,1) infinite" }} />
        <div style={{ position: "absolute", width: 9, height: 9, margin: -4, borderRadius: "50%", background: "#c69749" }} />
      </div>
      {/* compass rose */}
      <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: 112, height: 112 }}>
        <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "1.5px solid rgba(198,151,73,0.55)", background: "rgba(255,255,255,0.4)" }} />
        <div style={{ position: "absolute", inset: 15, borderRadius: "50%", border: "1px solid rgba(198,151,73,0.4)" }} />
        <div style={{ ...label, left: "50%", top: 3, transform: "translateX(-50%)", color: "#8a6420" }}>N</div>
        <div style={{ ...label, left: "50%", bottom: 3, transform: "translateX(-50%)", color: "#b6a06a" }}>S</div>
        <div style={{ ...label, left: 5, top: "50%", transform: "translateY(-50%)", color: "#b6a06a" }}>W</div>
        <div style={{ ...label, right: 5, top: "50%", transform: "translateY(-50%)", color: "#b6a06a" }}>E</div>
        {/* spinning needle — inset:0 fills the rose so rotate spins about its centre */}
        <div style={{ position: "absolute", inset: 0, animation: "asbSpin 9s linear infinite" }}>
          <div style={{ position: "absolute", left: "50%", top: 15, bottom: "50%", width: 0, transform: "translateX(-50%)", borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderBottom: "41px solid #c0392b" }} />
          <div style={{ position: "absolute", left: "50%", top: "50%", bottom: 15, width: 0, transform: "translateX(-50%)", borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderTop: "41px solid #13314f" }} />
        </div>
        <div style={{ position: "absolute", left: "50%", top: "50%", width: 8, height: 8, margin: -4, borderRadius: "50%", background: "#c69749", border: "1px solid #8a6420" }} />
      </div>
    </div>
  );
}

function Scene({ variant }: { variant: ComingSoonVariant }) {
  if (variant === "radar") return <RadarScene />;
  if (variant === "beacon") return <BeaconScene />;
  return <CompassScene />;
}

/* ---- per-variant theming --------------------------------------------------
   Radar and beacon are dark navy cards; compass is its own light parchment
   palette (matching its sea-chart scene) so the whole card reads as one piece. */
type CardTheme = {
  cardBg: string;
  cardBorder: string;
  shadow: string;
  eyebrow: string;
  title: string;
  body: string;
  track: string;
  buttonBg: string;
  buttonColor: string;
  trailer: string;
};

const DARK_THEME: CardTheme = {
  cardBg: "#0a1a2f",
  cardBorder: "1px solid rgba(255,255,255,0.10)",
  shadow: "0 24px 70px rgba(5,14,28,0.55)",
  eyebrow: "#c69749",
  title: "#faf6ee",
  body: "#9bb6d1",
  track: "rgba(255,255,255,0.10)",
  buttonBg: "#c69749",
  buttonColor: "#0a1a2f",
  trailer: "#5f7da0",
};

const LIGHT_THEME: CardTheme = {
  cardBg: "#faf6ee",
  cardBorder: "1px solid #e8dcc0",
  shadow: "0 24px 70px rgba(10,26,47,0.30)",
  eyebrow: "#8a6420",
  title: "#102a47",
  body: "#5a6776",
  track: "rgba(150,120,60,0.18)",
  buttonBg: "#102a47",
  buttonColor: "#faf6ee",
  trailer: "#94865f",
};

const THEME: Record<ComingSoonVariant, CardTheme> = {
  radar: DARK_THEME,
  beacon: DARK_THEME,
  compass: LIGHT_THEME,
};

export function ComingSoon({ variant }: { variant: ComingSoonVariant }) {
  const copy = COPY[variant];
  const t = THEME[variant];
  return (
    <div
      className="asb-cs-card"
      style={{
        position: "relative",
        width: 460,
        maxWidth: "92%",
        background: t.cardBg,
        border: t.cardBorder,
        borderTop: "2px solid #c69749",
        borderRadius: 16,
        boxShadow: t.shadow,
        overflow: "hidden",
        fontFamily:
          "var(--font-inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif)",
      }}
    >
      <Scene variant={variant} />

      <div style={{ padding: "20px 28px 24px", textAlign: "center" }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.16em", color: t.eyebrow, marginBottom: 9 }}>
          {copy.eyebrow}
        </div>
        <h2
          style={{
            fontFamily: "var(--font-fraunces, Georgia, 'Times New Roman', serif)",
            fontWeight: 500,
            fontSize: 25,
            lineHeight: 1.15,
            letterSpacing: "-0.01em",
            color: t.title,
            margin: "0 0 10px",
          }}
        >
          {copy.title}
        </h2>
        <p style={{ fontSize: 13.5, lineHeight: 1.6, color: t.body, margin: "0 auto 12px", maxWidth: 340 }}>
          {copy.body}
        </p>

        {copy.trailer && (
          <div style={{ fontSize: 20, marginBottom: 16 }}>{copy.trailer}</div>
        )}

        {/* indeterminate brass progress */}
        <div style={{ position: "relative", height: 4, width: 200, margin: "0 auto 20px", background: t.track, borderRadius: 999, overflow: "hidden" }}>
          <div style={{ position: "absolute", top: 0, bottom: 0, width: "38%", borderRadius: 999, background: "linear-gradient(90deg, rgba(198,151,73,0), #c69749 50%, rgba(198,151,73,0))", animation: "asbShimmer 1.9s cubic-bezier(0.4,0,0.2,1) infinite" }} />
        </div>

        <Link
          href="/dashboard"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            background: t.buttonBg,
            color: t.buttonColor,
            textDecoration: "none",
            fontSize: 13.5,
            fontWeight: 700,
            padding: "11px 22px",
            borderRadius: 8,
          }}
        >
          Return to Dashboard →
        </Link>
        <div style={{ fontSize: 11.5, color: t.trailer, marginTop: 14 }}>
          We&apos;ll signal you the moment it opens.
        </div>
      </div>
    </div>
  );
}

