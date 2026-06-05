// asb/map-overlays.jsx, chrome and overlays for MapPane
// All overlays share the same visual language:
//   bg rgba(8,16,28, .85–.92), 0.5px borders, tinted by domain
//   (green = cargo, blue = vessel, amber = voyage/data).

(function () {

// ── Layer pill (single, with tooltip) ─────────────────────────────────
window.LayerPill = function LayerPill({ label, on, onClick, tooltip, dot }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div style={{ position: "relative" }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}>
      {hover && tooltip && (
        <div style={{
          position: "absolute", bottom: "calc(100% + 8px)", left: "50%",
          transform: "translateX(-50%)", width: 200,
          background: "#1B3A5C", color: "rgba(255,255,255,0.92)",
          fontSize: 11, lineHeight: 1.4, padding: "6px 9px",
          borderRadius: 5, zIndex: 30,
          boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
          pointerEvents: "none", fontFamily: "var(--asb-font)",
        }}>
          {tooltip}
          <div style={{
            position: "absolute", top: "100%", left: "50%",
            transform: "translateX(-50%)", width: 0, height: 0,
            borderLeft: "5px solid transparent",
            borderRight: "5px solid transparent",
            borderTop: "5px solid #1B3A5C",
          }} />
        </div>
      )}
      <button onClick={onClick} style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        padding: "4px 9px",
        background: on ? "rgba(24,95,165,0.42)" : "transparent",
        border: `0.5px solid ${on ? "rgba(24,95,165,0.85)" : "rgba(255,255,255,0.14)"}`,
        color: on ? "#fff" : "rgba(255,255,255,0.55)",
        borderRadius: 999,
        fontSize: 9, fontFamily: "var(--asb-font)",
        cursor: "pointer", whiteSpace: "nowrap",
        transition: "all var(--t-fast)",
        letterSpacing: "0.03em", fontWeight: 500,
      }}>
        {dot && <span style={{
          width: 6, height: 6, borderRadius: 999,
          background: dot, opacity: on ? 1 : 0.5,
          display: "inline-block",
        }} />}
        {label}
        <span style={{
          fontSize: 8, color: "rgba(255,255,255,0.4)",
          marginLeft: 1, lineHeight: 1,
        }}>?</span>
      </button>
    </div>
  );
};

// ── Horizontal pill strip container ───────────────────────────────────
window.LayerPillStrip = function LayerPillStrip({ children, position }) {
  return (
    <div style={{
      position: "absolute",
      left: "50%", transform: "translateX(-50%)",
      ...position,
      display: "inline-flex", gap: 4,
      padding: "5px 6px",
      background: "rgba(8,14,26,0.88)",
      border: "0.5px solid rgba(255,255,255,0.10)",
      borderRadius: 999,
      backdropFilter: "blur(6px)",
      WebkitBackdropFilter: "blur(6px)",
      zIndex: 8,
    }}>
      {children}
    </div>
  );
};

// ── Map filter bar (top of map) ───────────────────────────────────────
window.MapFilterBar = function MapFilterBar({
  pageFilterSummary,
  standalone, setStandalone,
  standaloneChips, setStandaloneChips,
  onClear,
}) {
  const chipStyle = (active) => ({
    padding: "3px 7px", fontSize: 9, fontFamily: "var(--asb-font)",
    background: active ? "rgba(24,95,165,0.35)" : "transparent",
    border: `0.5px solid ${active ? "rgba(24,95,165,0.7)" : "rgba(255,255,255,0.18)"}`,
    color: active ? "#fff" : "rgba(255,255,255,0.62)",
    borderRadius: 3, cursor: standalone ? "pointer" : "default",
    letterSpacing: "0.02em", whiteSpace: "nowrap",
    transition: "all var(--t-fast)",
  });

  const hasActive = standalone && Object.values(standaloneChips).some(v => v && v !== "Any");
  const noteVisible = standalone;

  return (
    <div style={{
      position: "absolute", top: 0, left: 0, right: 0,
      background: "rgba(8,14,26,0.88)",
      borderBottom: "0.5px solid rgba(255,255,255,0.10)",
      backdropFilter: "blur(6px)",
      WebkitBackdropFilter: "blur(6px)",
      padding: "6px 10px",
      display: "flex", alignItems: "center", gap: 8,
      zIndex: 7,
      flexWrap: "wrap",
    }}>
      {/* Mode label */}
      <span style={{
        fontSize: 8, color: "rgba(255,255,255,0.45)",
        textTransform: "uppercase", letterSpacing: "0.08em",
        fontWeight: 600, marginRight: 2,
      }}>Filter</span>

      {/* Chips */}
      {standalone ? (
        <>
          {[
            ["Zone",       standaloneChips.zone],
            ["Port",       standaloneChips.port],
            ["Cargo type", standaloneChips.cargoType],
            ["DWT range",  standaloneChips.dwt],
            ["Laycan",     standaloneChips.laycan],
            ["Geared",     standaloneChips.geared ? "Yes" : null],
          ].filter(([_, v]) => v).map(([k, v]) => (
            <span key={k} style={chipStyle(true)}>
              <span style={{ opacity: 0.6 }}>{k}:</span> {v}
            </span>
          ))}
          {!hasActive && (
            <span style={{
              fontSize: 9, color: "rgba(255,255,255,0.35)",
              fontStyle: "italic", letterSpacing: "0.02em",
            }}>No map filters set, add a chip…</span>
          )}
          {/* Demo: chips that can be added in standalone mode */}
          {!standaloneChips.zone && (
            <button style={chipStyle(false)} onClick={() => setStandaloneChips(s => ({ ...s, zone: "AG" }))}>+ Zone</button>
          )}
          {!standaloneChips.cargoType && (
            <button style={chipStyle(false)} onClick={() => setStandaloneChips(s => ({ ...s, cargoType: "Grain" }))}>+ Cargo type</button>
          )}
          {!standaloneChips.dwt && (
            <button style={chipStyle(false)} onClick={() => setStandaloneChips(s => ({ ...s, dwt: "5K–15K" }))}>+ DWT range</button>
          )}
          {hasActive && (
            <button style={{
              background: "transparent", border: "none",
              color: "rgba(239,159,39,0.85)", fontSize: 9,
              cursor: "pointer", textDecoration: "underline",
              padding: 0, marginLeft: 2,
            }} onClick={onClear}>✕ Clear map filter</button>
          )}
        </>
      ) : (
        pageFilterSummary.length ? pageFilterSummary.map((s, i) => (
          <span key={i} style={{
            ...chipStyle(true),
            background: "rgba(255,255,255,0.05)",
            borderColor: "rgba(255,255,255,0.14)",
            color: "rgba(255,255,255,0.72)",
            cursor: "default",
          }}>{s}</span>
        )) : (
          <span style={{
            fontSize: 9, color: "rgba(255,255,255,0.35)",
            fontStyle: "italic", letterSpacing: "0.02em",
          }}>Mirroring page filter, none set</span>
        )
      )}

      {/* Note */}
      {noteVisible && (
        <span style={{
          fontSize: 9, color: "rgba(239,159,39,0.85)",
          marginLeft: 4, letterSpacing: "0.01em",
        }}>· Map filter is independent, page filter unchanged.</span>
      )}

      {/* Spacer */}
      <span style={{ flex: 1 }} />

      {/* Mode pill */}
      <button onClick={() => setStandalone(s => !s)} style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        padding: "3px 9px",
        background: standalone ? "rgba(239,159,39,0.25)" : "rgba(255,255,255,0.06)",
        border: `0.5px solid ${standalone ? "rgba(239,159,39,0.7)" : "rgba(255,255,255,0.18)"}`,
        color: standalone ? "#EF9F27" : "rgba(255,255,255,0.7)",
        borderRadius: 999,
        fontSize: 9, fontFamily: "var(--asb-font)",
        cursor: "pointer", letterSpacing: "0.02em",
        transition: "all var(--t-fast)",
        whiteSpace: "nowrap", fontWeight: 500,
      }} title="Toggle map-independent filter mode">
        <span style={{ fontSize: 10, lineHeight: 1 }}>{standalone ? "◈" : "↻"}</span>
        {standalone ? "Standalone" : "Following page filter"}
      </button>
    </div>
  );
};

// ── Fullscreen button (top-right of map) ──────────────────────────────
window.FullscreenBtn = function FullscreenBtn({ on, onClick }) {
  return (
    <button onClick={onClick} title={on ? "Exit fullscreen" : "Enter fullscreen"}
      style={{
        position: "absolute", top: 40, right: 8,
        width: 28, height: 28,
        background: "rgba(10,20,35,0.85)",
        border: "0.5px solid rgba(255,255,255,0.15)",
        borderRadius: 4, color: "#fff", cursor: "pointer",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        zIndex: 8, padding: 0,
        transition: "background var(--t-fast)",
      }}
      onMouseEnter={e => e.currentTarget.style.background = "rgba(24,95,165,0.6)"}
      onMouseLeave={e => e.currentTarget.style.background = "rgba(10,20,35,0.85)"}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        {on ? (
          // Compress / collapse icon
          <>
            <path d="M 5 1 L 5 5 L 1 5" />
            <path d="M 7 1 L 7 5 L 11 5" />
            <path d="M 5 11 L 5 7 L 1 7" />
            <path d="M 7 11 L 7 7 L 11 7" />
          </>
        ) : (
          // Expand icon, four outward arrows
          <>
            <path d="M 1 4 L 1 1 L 4 1" />
            <path d="M 11 4 L 11 1 L 8 1" />
            <path d="M 1 8 L 1 11 L 4 11" />
            <path d="M 11 8 L 11 11 L 8 11" />
          </>
        )}
      </svg>
    </button>
  );
};

// ── Exit fullscreen strip (top-centre) ────────────────────────────────
window.ExitFullscreenStrip = function ExitFullscreenStrip({ onClick }) {
  return (
    <button onClick={onClick} style={{
      position: "absolute", top: 0, left: "50%",
      transform: "translateX(-50%)",
      width: 180, height: 28,
      background: "rgba(10,20,35,0.8)",
      border: "0.5px solid rgba(255,255,255,0.12)",
      borderTop: "none",
      borderRadius: "0 0 6px 6px",
      color: "#fff", cursor: "pointer",
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      gap: 6, fontSize: 10, fontFamily: "var(--asb-font)",
      letterSpacing: "0.02em",
      zIndex: 50,
      transition: "background var(--t-fast)",
    }}
      onMouseEnter={e => e.currentTarget.style.background = "rgba(24,95,165,0.7)"}
      onMouseLeave={e => e.currentTarget.style.background = "rgba(10,20,35,0.8)"}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M 7 2 L 3 5 L 7 8" />
      </svg>
      Exit fullscreen
      <span style={{ color: "rgba(255,255,255,0.45)", fontSize: 9, marginLeft: 2 }}>ESC</span>
    </button>
  );
};

// ── ECDIS-style scale bar (bottom-right) ──────────────────────────────
window.ScaleBar = function ScaleBar({ nmPerWorld, mapScale }) {
  // Pick a nice NM number that displays at 60–120 px
  const targets = [10, 25, 50, 100, 250, 500, 1000, 2000];
  // pixels per NM = mapScale (worldPx per screenPx) inverse * worldPx per NM (1/nmPerWorld)
  // screenPx per NM = mapScale * (1 / nmPerWorld)
  const pxPerNm = mapScale / nmPerWorld;
  let best = targets[0];
  for (const t of targets) {
    const w = t * pxPerNm;
    if (w >= 60 && w <= 140) { best = t; break; }
    if (w < 60) best = t;
  }
  const widthPx = best * pxPerNm;

  return (
    <div style={{
      position: "absolute", bottom: 8, right: 44,
      display: "flex", flexDirection: "column", alignItems: "center",
      pointerEvents: "none",
      zIndex: 4,
    }}>
      <div style={{
        fontSize: 9, color: "rgba(255,255,255,0.7)",
        fontFamily: "var(--asb-font-mono)",
        letterSpacing: "0.05em", marginBottom: 2,
        textShadow: "0 1px 2px rgba(0,0,0,0.6)",
      }}>{best.toLocaleString()} NM</div>
      <svg width={widthPx + 4} height="8" style={{ overflow: "visible" }}>
        <line x1="2" y1="4" x2={widthPx + 2} y2="4"
          stroke="rgba(255,255,255,0.75)" strokeWidth="1" />
        <line x1="2" y1="1" x2="2" y2="7"
          stroke="rgba(255,255,255,0.75)" strokeWidth="1" />
        <line x1={widthPx + 2} y1="1" x2={widthPx + 2} y2="7"
          stroke="rgba(255,255,255,0.75)" strokeWidth="1" />
      </svg>
    </div>
  );
};

// ── Vessel hover card ─────────────────────────────────────────────────
window.VesselHoverCard = function VesselHoverCard({ vessel, screenX, screenY, side, vAlign }) {
  const W = 200;
  const left = side === "left" ? screenX - W - 14 : screenX + 14;
  const top  = vAlign === "above" ? screenY - 120 : screenY - 30;
  return (
    <div style={{
      position: "absolute", left, top, width: W,
      background: "rgba(8,16,28,0.94)",
      border: "0.5px solid rgba(24,95,165,0.7)",
      borderRadius: 5,
      fontSize: 10, color: "rgba(255,255,255,0.92)",
      fontFamily: "var(--asb-font)",
      zIndex: 12, pointerEvents: "none",
      boxShadow: "0 4px 14px rgba(0,0,0,0.5)",
    }}>
      <div style={{
        padding: "6px 9px 5px",
        borderBottom: "0.5px solid rgba(255,255,255,0.08)",
      }}>
        <div style={{ fontSize: 9, color: "#185FA5", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 2 }}>Vessel</div>
        <div style={{ fontSize: 12, fontWeight: 500, color: "#fff", lineHeight: 1.2 }}>{vessel.name}</div>
        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.55)", marginTop: 2 }}>{vessel.type} · {vessel.dwt} DWT</div>
      </div>
      <div style={{ padding: "5px 9px 7px" }}>
        <Row k="Open" v={vessel.openPort} color="#97C459" />
        <Row k="Open date" v={vessel.openDate} dot={vessel.openDateUrgency} />
        <Row k="DWCC" v={vessel.dwcc} mono color="#9bb8df" />
        <Row k="VLSFO sea" v={`${vessel.fuel?.vlsfoSea ?? "—"} mt/d`} muted />
        {vessel.matches ? (
          <div style={{ marginTop: 4 }}>
            <span style={{
              display: "inline-block", fontSize: 9,
              background: "rgba(24,95,165,0.4)", color: "#9bb8df",
              border: "0.5px solid rgba(24,95,165,0.7)",
              padding: "1px 6px", borderRadius: 999, fontWeight: 500,
              letterSpacing: "0.02em",
            }}>{vessel.matches} matches</span>
          </div>
        ) : null}
      </div>
    </div>
  );
};

// ── Cargo hover mini card (from port popup row) ───────────────────────
window.CargoMiniCard = function CargoMiniCard({ cargo, screenX, screenY, side }) {
  const W = 210;
  const left = side === "left" ? screenX - W - 8 : screenX + 8;
  return (
    <div style={{
      position: "absolute", left, top: screenY - 8, width: W,
      background: "rgba(8,16,28,0.94)",
      border: "0.5px solid rgba(151,196,89,0.55)",
      borderRadius: 5,
      fontSize: 10, color: "rgba(255,255,255,0.92)",
      fontFamily: "var(--asb-font)",
      zIndex: 22, pointerEvents: "none",
      boxShadow: "0 4px 14px rgba(0,0,0,0.5)",
    }}>
      <div style={{ padding: "6px 9px 5px", borderBottom: "0.5px solid rgba(255,255,255,0.08)" }}>
        <div style={{ fontSize: 9, color: "#97C459", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 2 }}>Cargo</div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: "#fff", lineHeight: 1.2 }}>{cargo.cargo}</span>
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.45)", fontFamily: "var(--asb-font-mono)" }}>{cargo.refId}</span>
        </div>
      </div>
      <div style={{ padding: "5px 9px 7px" }}>
        <Row k="POL → POD" v={`${cargo.route.polName} → ${cargo.route.podName}`} />
        <Row k="Quantity" v={`${cargo.qtyMt} MT`} mono color="#9bb8df" />
        <Row k="Laycan" v={`${cargo.laycanFrom.slice(0,6)} – ${cargo.laycanTo.slice(0,6)}`}
          dot={cargo.laycanDays <= 3 ? "red" : cargo.laycanDays <= 7 ? "amber" : "green"} />
        <Row k="Load terms" v={cargo.loadTerms} muted />
        {cargo.matches ? (
          <div style={{ marginTop: 4 }}>
            <span style={{
              display: "inline-block", fontSize: 9,
              background: "rgba(24,95,165,0.4)", color: "#9bb8df",
              border: "0.5px solid rgba(24,95,165,0.7)",
              padding: "1px 6px", borderRadius: 999, fontWeight: 500,
            }}>{cargo.matches} matches</span>
          </div>
        ) : null}
      </div>
    </div>
  );
};

// ── Port click popup (tabs: Cargo / Vessels) ──────────────────────────
window.PortPopup = function PortPopup({
  port, cargos, vessels,
  screenX, screenY, side, vAlign,
  onClose, onSelectCargo, onSelectVessel,
  onHoverCargo, onLeaveCargo,
}) {
  const [tab, setTab] = React.useState("cargo");
  const W = 220;
  const H = 240;
  const left = side === "left" ? screenX - W - 14 : screenX + 14;
  const top  = vAlign === "above" ? Math.max(8, screenY - H - 10) : screenY - 30;

  return (
    <div style={{
      position: "absolute", left, top, width: W,
      maxHeight: H + 10,
      background: "rgba(8,16,28,0.95)",
      border: "0.5px solid rgba(255,255,255,0.18)",
      borderRadius: 6,
      fontSize: 11, color: "rgba(255,255,255,0.92)",
      fontFamily: "var(--asb-font)",
      zIndex: 18,
      boxShadow: "0 6px 18px rgba(0,0,0,0.55)",
      display: "flex", flexDirection: "column", overflow: "hidden",
    }} onClick={(e) => e.stopPropagation()}>
      {/* Header */}
      <div style={{
        padding: "7px 10px",
        borderBottom: "0.5px solid rgba(255,255,255,0.08)",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <div>
          <div style={{
            fontSize: 8, color: "rgba(255,255,255,0.45)",
            textTransform: "uppercase", letterSpacing: "0.1em",
            fontWeight: 600,
          }}>Port</div>
          <div style={{ fontSize: 12, fontWeight: 500, color: "#fff", lineHeight: 1.2 }}>{port.name}</div>
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.5)", marginTop: 1, fontFamily: "var(--asb-font-mono)" }}>{port.zone}</div>
        </div>
        <button onClick={onClose} style={{
          background: "transparent", border: "none", color: "rgba(255,255,255,0.5)",
          cursor: "pointer", fontSize: 14, padding: 0, width: 16, height: 16,
          lineHeight: 1,
        }}>×</button>
      </div>

      {/* Tabs */}
      <div style={{
        display: "flex",
        borderBottom: "0.5px solid rgba(255,255,255,0.08)",
      }}>
        {[
          ["cargo",  "Cargo",   cargos.length, "#97C459"],
          ["vessel", "Vessels", vessels.length, "#185FA5"],
        ].map(([id, label, n, color]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            flex: 1, padding: "6px 8px",
            background: tab === id ? "rgba(24,95,165,0.15)" : "transparent",
            border: "none",
            borderBottom: tab === id ? `1.5px solid ${color}` : "1.5px solid transparent",
            color: tab === id ? "#fff" : "rgba(255,255,255,0.55)",
            fontSize: 10, fontWeight: 500, cursor: "pointer",
            fontFamily: "var(--asb-font)", letterSpacing: "0.02em",
            transition: "all var(--t-fast)",
          }}>
            {label} <span style={{ color: "rgba(255,255,255,0.4)", marginLeft: 2 }}>({n})</span>
          </button>
        ))}
      </div>

      {/* List */}
      <div style={{ overflowY: "auto", padding: 4, flex: 1, minHeight: 0, maxHeight: H - 80 }}>
        {tab === "cargo" && (
          cargos.length === 0
            ? <Empty label="No cargo at this port." />
            : cargos.map(c => {
              const urgency = c.laycanDays <= 3 ? "#C5474D" : c.laycanDays <= 7 ? "#EF9F27" : "#97C459";
              return (
                <div key={c.id}
                  onClick={() => onSelectCargo && onSelectCargo(c)}
                  onMouseEnter={(e) => onHoverCargo && onHoverCargo(c, e.currentTarget)}
                  onMouseLeave={onLeaveCargo}
                  style={{
                    padding: "5px 7px", borderRadius: 3,
                    cursor: "pointer", marginBottom: 2,
                    transition: "background var(--t-fast)",
                  }}
                  onMouseOver={e => e.currentTarget.style.background = "rgba(151,196,89,0.10)"}
                  onMouseOut={e => e.currentTarget.style.background = "transparent"}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ width: 6, height: 6, borderRadius: 999, background: urgency, flexShrink: 0 }} />
                    <span style={{ fontSize: 11, fontWeight: 500, color: "#fff", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.cargo}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 1, paddingLeft: 11 }}>
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)" }}>→ {c.route.podZone}</span>
                    <span style={{ fontSize: 10, color: "#9bb8df", fontFamily: "var(--asb-font-mono)" }}>{c.qtyMt} MT</span>
                  </div>
                  <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", paddingLeft: 11, marginTop: 1 }}>
                    {c.laycanFrom.slice(0,6)} – {c.laycanTo.slice(0,6)}
                  </div>
                </div>
              );
            })
        )}
        {tab === "vessel" && (
          vessels.length === 0
            ? <Empty label="No vessels open at this port." />
            : vessels.map(v => (
              <div key={v.id}
                onClick={() => onSelectVessel && onSelectVessel(v)}
                style={{
                  padding: "5px 7px", borderRadius: 3, cursor: "pointer",
                  marginBottom: 2, transition: "background var(--t-fast)",
                }}
                onMouseOver={e => e.currentTarget.style.background = "rgba(24,95,165,0.12)"}
                onMouseOut={e => e.currentTarget.style.background = "transparent"}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <svg width="8" height="10" viewBox="-5 -7 10 14" style={{ flexShrink: 0 }}>
                    <path d="M 0 -6 L 4 5 L 0 3 L -4 5 Z"
                      fill="#185FA5" stroke="rgba(255,255,255,0.5)" strokeWidth="0.5" />
                  </svg>
                  <span style={{ fontSize: 11, fontWeight: 500, color: "#fff", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.name}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 1, paddingLeft: 13 }}>
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.55)", fontFamily: "var(--asb-font-mono)" }}>{v.dwt}</span>
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.55)" }}>{v.openDate.slice(0,6)}</span>
                </div>
              </div>
            ))
        )}
      </div>
    </div>
  );
};

// ── Row helper for hover cards ────────────────────────────────────────
function Row({ k, v, color, mono, muted, dot }) {
  const DOT = { red: "#C5474D", amber: "#EF9F27", green: "#97C459" };
  return (
    <div style={{
      display: "flex", justifyContent: "space-between",
      gap: 6, padding: "1px 0",
    }}>
      <span style={{ color: "rgba(255,255,255,0.5)", fontSize: 10 }}>{k}</span>
      <span style={{
        color: muted ? "rgba(255,255,255,0.55)" : (color || "#fff"),
        fontSize: 10, fontWeight: muted ? 400 : 500,
        fontFamily: mono ? "var(--asb-font-mono)" : "var(--asb-font)",
        display: "inline-flex", alignItems: "center", gap: 4,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        maxWidth: 130,
      }}>
        {dot && <span style={{ width: 6, height: 6, borderRadius: 999, background: DOT[dot] || dot, flexShrink: 0 }} />}
        {v}
      </span>
    </div>
  );
}

function Empty({ label }) {
  return <div style={{
    padding: "12px 8px", fontSize: 10,
    color: "rgba(255,255,255,0.4)", fontStyle: "italic",
    textAlign: "center",
  }}>{label}</div>;
}

})();
