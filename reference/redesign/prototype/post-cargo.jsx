// asb/post-cargo.jsx, Post Cargo wizard (5 steps, single cargo)
// Cargo & Quantity → Ports → Laycan & Terms → Safety → Review
//
// Matches the existing platform: navy #1B3A5C, blue #185FA5, white cards w/ 0.5px
// borders, 8px card radius (form cards), no shadows, Arial. Built on top of
// tokens.css, no new globals, with a small local <style> for wizard chrome.

// COMMODITIES is DERIVED from the data-driven master classification map
// (window.ASB_CARGO_CLASS in data.js) — classification logic is never
// hardcoded in this component. Each row keeps the legacy shape the form uses
// (name/bcsn/group/type/sf/code/form/css/pkg) PLUS the regime fields:
//   market · defaultForm · dualForm · grain · imsbcCode · grainCode · cssCode
//   · plausibleGroups
// legacy `form`: "dry" (bulk, single-form) | "break" | "dual" (flips bulk↔bagged)
const COMMODITIES = (window.ASB_CARGO_CLASS?.order || []).map((market) => {
  const m = window.ASB_CARGO_CLASS.map[market];
  const legacyForm = m.defaultForm === "break" ? "break" : (m.dualForm ? "dual" : "dry");
  const type = m.grain ? "Grain" : (m.defaultForm === "break" ? "Break Bulk" : "Dry Bulk");
  return {
    market,
    name: m.displayName || market,
    bcsn: m.bcsn,
    group: m.group,                         // null for grain / break-bulk
    type,
    sf: m.sf,
    code: m.imsbcCode || m.cssCode || m.grainCode || "—",
    form: legacyForm,
    css: m.css || "Unit loads",
    pkg: m.defaultForm === "break" ? "Other" : "Bulk",
    // regime fields (Part 1+)
    defaultForm: m.defaultForm, dualForm: m.dualForm, grain: m.grain,
    imsbcCode: m.imsbcCode, grainCode: m.grainCode, cssCode: m.cssCode,
    plausibleGroups: m.plausibleGroups,
  };
});

// CSS Code (Code of Safe Practice for Cargo Stowage & Securing) — the 12 official
// break-bulk form-categories, per the Arab ShipBroker CSS_BreakBulk reference
// sheet. Each carries the stowage/securing trigger it implies + the market names
// that fall under it. Break-bulk "packing" is chosen from THIS list.
const CSS_BREAKBULK = [
  { id: "CSS-01", label: "Containers on non-cellular ships", securing: "Stow fore-and-aft; wire/chain lashings; timber shoring ≤2 m; secure against sliding/tipping.", aliases: "Deck containers" },
  { id: "CSS-02", label: "Portable tanks (tank-containers)", securing: "Lashing ≤25° sliding, 45–60° tipping; CSC compliance; IMDG if DG.", aliases: "Tank-containers" },
  { id: "CSS-03", label: "Portable receptacles", securing: "Dunnage off steel deck; stow upright for liquefied gas; box/crib, brace, chock.", aliases: "Gas cylinders, receptacles" },
  { id: "CSS-04", label: "Wheel-based (rolling) cargoes", securing: "Marked securing points; brakes set; chocks; steel chain/wire lashings; stow fore-and-aft.", aliases: "Shredded tyres, rolling units" },
  { id: "CSS-05", label: "Heavy cargo items", securing: "CoG + bedding info; timber to spread load; lashing 25° slide / 45–60° tip; shoring at large angles.", aliases: "Project cargo, marble blocks, granite blocks" },
  { id: "CSS-06", label: "Coiled sheet steel", securing: "Bottom stow, axes fore-and-aft, dunnage athwartships, locking coils, wedges, top-tier lashing.", aliases: "Steel coils, hot-rolled coils" },
  { id: "CSS-07", label: "Heavy metal products", securing: "Compact side-to-side, no voids; don't exceed tank-top load; shore every frame ≥1 m; top-layer lashing.", aliases: "Steel rebars, billets, wire rod in coils, plates, slabs" },
  { id: "CSS-08", label: "Anchor chains", securing: "Never on bare metal — wooden ceiling/dunnage; tight stow; top layer lashed both sides.", aliases: "Anchor chains" },
  { id: "CSS-09", label: "Metal scrap in bulk", securing: "Protect side plating/pipes; heavy first; no voids; lash/overstow heavy pieces; watch tank-top load.", aliases: "Scrap metal (borings/turnings → IMSBC)" },
  { id: "CSS-10", label: "Flexible IBC (FIBC / big bags)", securing: "Stow tight sides→centre; chock centre voids; gratings/plywood + wire lashings; capacity ≤3 m³.", aliases: "Bagged cargo (big bags)" },
  { id: "CSS-11", label: "Logs (under-deck stow)", securing: "Pre-stow plan; heaviest first; compact fore-and-aft, fill athwartship voids; bilge & stability checks.", aliases: "Logs" },
  { id: "CSS-12", label: "Unit loads", securing: "Clean flush deck; block stow, no voids; gratings/plywood + wire lashings; check pallet strength if tiered.", aliases: "Bagged cargo, sugar (bags), MDF / chipboards, general cargo, mixed BB" },
];
const CSS_CATEGORIES = CSS_BREAKBULK.map(c => c.label);
const cssMeta = (label) => CSS_BREAKBULK.find(c => c.label === label) || null;

// Stowage-factor conversion: 1 m³/t = 35.87 ft³/t
const FT_PER_M3 = 35.87;
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Active classification reference, derived from the two toggles (Q1 form, Q2
// grain) — never from a hardcoded list. Returns the ONE live regime; the other
// two classifiers are n/a by definition (mutually exclusive).
//   form "break"            → CSS   (break-bulk / bagged)
//   form "bulk" + grain     → GRAIN (International Grain Code)
//   form "bulk" + non-grain → IMSBC (group A/B/C)
function activeClassification(state) {
  if (!state.commodity && !state.unmapped) return null;
  const form = state.form || (state.commodity?.defaultForm) || "bulk";
  if (form === "break") return { kind: "css", regime: "CSS" };
  if (state.grain)      return { kind: "grain", regime: "GRAIN" };
  return { kind: "imsbc", regime: "IMSBC", group: state.imsbcGroup || state.commodity?.group || "C" };
}
const IMSBC_DESC = {
  A: "Group A, may liquefy; moisture limit (TML) controls apply.",
  B: "Group B, possible chemical hazard.",
  C: "Group C, neither A nor B; standard bulk declaration.",
};

// Derived regime badge (READ-ONLY). The broker can't edit the regime directly;
// it changes only as a consequence of the two toggles. Colours: GRAIN brass ·
// IMSBC blue · CSS slate. Hover → the regime's tooltip (Part 2).
function RegimeChip({ regime, auto, noTip }) {
  const meta = window.ASB_CARGO_CLASS?.regimeMeta?.[regime];
  if (!meta) return null;
  const chip = <span className={`pc-regime is-${regime.toLowerCase()}`}>{meta.label}</span>;
  return (
    <span className="pc-regime-wrap">
      {noTip ? chip : <HoverTip tip={{ severity: "info", message: meta.tip }} position="top">{chip}</HoverTip>}
      {auto && <span className="pc-auto-tag">auto</span>}
    </span>
  );
}

// Port lookup is backed by the full UN/LOCODE reference (window.ASB_PORTS,
// window.ASB_findPorts, window.ASB_portMeta — see asb/ports-data.js, built from
// the attached upply-seaports.csv). Typing a port name auto-loads LOCODE + zone.
function searchPorts(q) { return window.ASB_findPorts ? window.ASB_findPorts(q, 7) : []; }
function portFromRaw(raw) {
  if (!raw || !window.ASB_portMeta) return null;
  const m = window.ASB_portMeta(raw);
  return { name: m.name, locode: m.locode, country: m.country, zone: m.shortZone, zoneFull: m.zone, zoneCode: m.zoneCode };
}
function portByLocode(code) {
  const raw = (window.ASB_PORTS || []).find(p => p.c === code);
  return raw ? portFromRaw(raw) : null;
}

const STEPS = ["Cargo & Qty", "Ports", "Laycan & Terms", "Safety", "Review"];

// ─────────────────────────────────────────────────────────────────────────────
// Tiny primitives
// ─────────────────────────────────────────────────────────────────────────────

function PCCard({ title, action, span, children, dashed }) {
  return (
    <div className={`pc-card${dashed ? " is-dashed" : ""}`} style={span ? { gridColumn: `span ${span}` } : null}>
      {(title || action) && (
        <div className="pc-card__head">
          <span className="pc-card__title">{title}</span>
          {action && <span className="pc-card__action">{action}</span>}
        </div>
      )}
      <div className="pc-card__body">{children}</div>
    </div>
  );
}

function PCSectionLabel({ children, style }) {
  return <div className="pc-section-label" style={style}>{children}</div>;
}

function PCChip({ active, disabled, onClick, children, style }) {
  return (
    <button type="button" className={`pc-chip${active ? " is-active" : ""}`} onClick={onClick} disabled={disabled} style={style}>
      {children}
    </button>
  );
}

function PCInput(props) { return <input className="pc-input" {...props} />; }
function PCSelect({ value, onChange, options, hint }) {
  return (
    <div>
      <div className="pc-select-wrap">
        <select className="pc-input" value={value} onChange={e => onChange(e.target.value)}>
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <span className="pc-select-caret">▾</span>
      </div>
      {hint && <div className="pc-hint" style={{ marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

function PCNote({ kind = "info", children }) {
  return <div className={`pc-note pc-note--${kind}`}>{children}</div>;
}

function PCSearchBox({ value, onChange, onPick, placeholder, results, renderResult, large }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div className="pc-search" ref={ref}>
      <span className="pc-search__icon">⌕</span>
      <input
        className={`pc-input pc-search__input${large ? " is-lg" : ""}`}
        value={value}
        placeholder={placeholder}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
      />
      {open && results && results.length > 0 && (
        <div className="pc-search__dropdown">
          {results.map((r, i) => (
            <div key={i} className="pc-search__row" onClick={() => { onPick(r); setOpen(false); }}>
              {renderResult(r)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Stepper
// ─────────────────────────────────────────────────────────────────────────────

function Stepper({ step, setStep }) {
  // collapsed mobile is handled in CSS by hiding .pc-stepper__row and showing .pc-stepper__mobile
  const pct = (step / (STEPS.length - 1)) * 100;
  return (
    <div className="pc-stepper">
      <div className="pc-stepper__row">
        {STEPS.map((label, i) => {
          const done = i < step;
          const active = i === step;
          return (
            <React.Fragment key={label}>
              <button
                type="button"
                className={`pc-stepper__item${done ? " is-done" : ""}${active ? " is-active" : ""}`}
                onClick={() => i <= step && setStep(i)}
              >
                <span className="pc-stepper__circle">{done ? "✓" : i + 1}</span>
                <span className="pc-stepper__label">{label}</span>
              </button>
              {i < STEPS.length - 1 && <span className={`pc-stepper__line${done ? " is-done" : ""}`} />}
            </React.Fragment>
          );
        })}
      </div>
      <div className="pc-stepper__mobile">
        <div className="pc-stepper__mobile-text">
          <strong>Step {step + 1} of {STEPS.length}</strong>, {STEPS[step]}
        </div>
        <div className="pc-stepper__bar"><div style={{ width: `${pct}%` }} /></div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1, CARGO & QUANTITY
// ─────────────────────────────────────────────────────────────────────────────

function Step1Cargo({ state, set }) {
  const [q, setQ] = React.useState("");
  const results = q ? COMMODITIES.filter(c =>
    c.name.toLowerCase().includes(q.toLowerCase()) ||
    c.bcsn.toLowerCase().includes(q.toLowerCase()) ||
    c.code.includes(q)
  ).slice(0, 6) : [];

  const sfCustom = state.sfCustom;
  const sfDefault = state.commodity?.sf;            // baseline value in ft³/t
  const isM3 = state.sfUnit === "m3";
  const sfDisplay = state.sf == null ? "" : round2(isM3 ? state.sf / FT_PER_M3 : state.sf);
  const sfOther = state.sf == null ? "" : (isM3 ? `${round2(state.sf)} ft³/t` : `${round2(state.sf / FT_PER_M3)} m³/t`);

  const cls = activeClassification(state);
  const regime = cls?.regime;

  function pickCommodity(c) {
    const form = c.defaultForm === "break" ? "break" : "bulk";
    set({
      commodity: c, unmapped: false, newName: "",
      cargoType: c.type,
      cssCategory: c.css || "Unit loads",
      packaging: form === "break" ? "Bagged" : "Bulk",
      sf: c.sf,
      sfUnit: "m3",
      sfCustom: false,
      form,
      grain: !!c.grain,
      imsbcGroup: null, guard: null,
    });
  }

  // GRACEFUL FALLBACK — name not in the map: don't guess, don't break.
  // Manual entry, broker sets bulk/grain, listing flagged pending classification.
  function useUnmapped(name) {
    set({
      commodity: null, unmapped: true, newName: name,
      cargoType: "Dry Bulk",
      form: "bulk", grain: false,
      sf: 47, sfUnit: "m3", sfCustom: false,
      packaging: "Bulk", cssCategory: "Unit loads",
      imsbcGroup: null, guard: null,
    });
    setQ("");
  }

  // Q1 — Bulk ↔ Break-Bulk. Grain is bulk-only, so leaving bulk clears it.
  const setForm = (f) => set({
    form: f,
    grain: f === "break" ? false : state.grain,
    packaging: f === "break" ? "Bagged" : "Bulk",
    guard: null,
  });

  // THE GUARD — the broker may attempt to change the hazard (IMSBC) class, but
  // an out-of-bounds value (not in the cargo's plausibleGroups from the MASTER
  // MAP) triggers a SOFT BLOCK instead of silently accepting it.
  function trySetGroup(g) {
    if (window.ASB_CARGO_CLASS.isPlausibleGroup(state.commodity, g)) {
      set({ imsbcGroup: g, guard: null });
    } else {
      set({ guard: { attempted: g } });   // doesn't apply the value
    }
  }

  // Quantity lives in the Cargo step now. Volume is auto-derived from the
  // stowage factor and shown in CBM (m³).
  const sfV = state.sf || 47;
  const minQ = parseFloat(state.minQty) || 0;
  const maxQ = parseFloat(state.maxQty) || 0;
  const cbmMin = (minQ * sfV / 35.315).toFixed(0);
  const cbmMax = (maxQ * sfV / 35.315).toFixed(0);

  return (
    <div className="pc-grid">
      {/* CARD 1, Commodity — MARKET NAME FIRST is the trigger for auto-suggest */}
      <PCCard title="What cargo are you offering?" span={3}>
        <PCSearchBox
          value={q}
          onChange={setQ}
          large
          placeholder="Search market name, Wheat, Rice, Phosphate, Steel Coils..."
          results={results}
          onPick={(c) => { pickCommodity(c); setQ(""); }}
          renderResult={(c) => {
            const reg = window.ASB_CARGO_CLASS.resolveRegime(c.defaultForm, c.grain);
            return (
              <div className="row-sb" style={{ width: "100%" }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: "var(--asb-navy)" }}>{c.name}</div>
                  <div style={{ fontSize: 10, color: "var(--asb-gray-500)" }}>
                    {c.bcsn} · {c.grain ? "Grain" : c.defaultForm === "break" ? "Break-Bulk" : "Bulk"} · SF {round2(c.sf / FT_PER_M3)} m³/t
                  </div>
                </div>
                <RegimeChip regime={reg} />
              </div>
            );
          }}
        />
        {q && results.length === 0 && (
          <div className="pc-unmapped-cta">
            <span className="pc-defn">“{q}” isn’t in the cargo dictionary yet.</span>
            <button type="button" className="pc-link" onClick={() => useUnmapped(q)}>
              + Use as new commodity, set classification manually
            </button>
          </div>
        )}

        {(state.commodity || state.unmapped) && (
          <>
            <div className="pc-bcsn-row">
              <span className="pc-bcsn-row__label">{state.unmapped ? "New commodity" : "BCSN · Bulk Cargo Shipping Name"}</span>
              <span className="pc-bcsn-row__name">{state.unmapped ? state.newName : state.commodity.bcsn}</span>
              {!state.unmapped && state.commodity.group && state.form === "bulk" && !state.grain && (
                <span className={`pc-pill-group is-g-${state.commodity.group.toLowerCase()}`}>IMSBC Group {state.commodity.group}</span>
              )}
            </div>

            {/* Classification trigger — two toggles (Q1, Q2) auto-set from the
                map, VISIBLE and CHANGEABLE; broker confirms or adjusts. */}
            <div className="pc-classify">
              <div className="pc-classify__qs">
                <div className="pc-classify__q">
                  <span className="pc-classify__qlabel">Bulk or Break-Bulk?</span>
                  <div className="pc-toggle-group">
                    <button type="button" className={`pc-toggle${state.form === "bulk" ? " is-on" : ""}`} onClick={() => setForm("bulk")}>Bulk</button>
                    <button type="button" className={`pc-toggle${state.form === "break" ? " is-on" : ""}`} onClick={() => setForm("break")}>Break-Bulk</button>
                  </div>
                </div>

                {/* Grain is bulk by definition — toggle only shows when Bulk. */}
                {state.form === "bulk" && (
                  <div className="pc-classify__q">
                    <span className="pc-classify__qlabel">Grain?</span>
                    <div className="pc-toggle-group">
                      <button type="button" className={`pc-toggle${state.grain ? " is-on" : ""}`} onClick={() => set({ grain: true })}>Yes</button>
                      <button type="button" className={`pc-toggle${!state.grain ? " is-on" : ""}`} onClick={() => set({ grain: false })}>No</button>
                    </div>
                  </div>
                )}

                <div className="pc-classify__q pc-classify__q--regime">
                  <span className="pc-classify__qlabel">Resolved regime</span>
                  <RegimeChip regime={regime} auto />
                </div>
              </div>

              {state.unmapped ? (
                <PCNote kind="amber">
                  <strong>New commodity — pending classification.</strong> Not in the dictionary, so nothing is guessed. Set Bulk/Grain yourself; auto-fill resumes once Arab ShipBroker adds this name to the map.
                </PCNote>
              ) : (
                <div className="pc-defn" style={{ marginTop: 8 }}>
                  Suggested from the cargo dictionary — confirm or adjust. You confirm; you don’t type it from scratch.
                </div>
              )}
            </div>
          </>
        )}
      </PCCard>

      {/* CARD 2, Cargo classification — ONE live classifier slot, the other two
          read n/a (mutually exclusive). The badge + code are auto-filled; the
          hazard class is guarded against implausible values (Part 3). */}
      <PCCard title="Cargo classification" span={2}>
        {(!state.commodity && !state.unmapped) ? (
          <div className="pc-hint">Pick a market name above, the classification regime fills in automatically.</div>
        ) : (
          <>
            <div className="pc-class-line">
              <span className="pc-class-type">
                {cls.kind === "imsbc" ? "Bulk, IMSBC Code applies"
                  : cls.kind === "grain" ? "Bulk Grain, International Grain Code applies"
                  : "Break-Bulk, CSS Code applies"}
              </span>
              <RegimeChip regime={regime} auto />
            </div>

            {/* THE ONE LIVE SLOT — relabels to the live regime */}
            {cls.kind === "imsbc" ? (
              <>
                <div className="pc-class-imsbc">
                  <span className={`pc-pill-group is-g-${cls.group.toLowerCase()}`}>IMSBC Group {cls.group}</span>
                  <span className="pc-class-desc">{IMSBC_DESC[cls.group]}</span>
                </div>
                <div className="pc-group-adjust">
                  <span className="pc-classify__qlabel">Hazard class (guarded)</span>
                  <div className="pc-toggle-group">
                    {["A", "B", "C"].map(g => (
                      <button key={g} type="button" className={`pc-toggle${cls.group === g ? " is-on" : ""}`} onClick={() => trySetGroup(g)}>Group {g}</button>
                    ))}
                  </div>
                </div>
                {state.guard && (
                  <div className="pc-guard" role="alert">
                    <div className="pc-guard__msg">
                      <strong>That classification doesn’t match this cargo.</strong> {state.unmapped ? "This commodity" : (state.commodity?.name)} can’t be IMSBC Group {state.guard.attempted} — the plausible classes come from the Arab ShipBroker cargo map, not a free choice.
                    </div>
                    <div className="pc-guard__actions">
                      <button type="button" className="pc-guard__btn is-primary" onClick={() => set({ guard: null })}>Keep suggested</button>
                      <button type="button" className="pc-guard__btn" onClick={() => set({ guard: null })}>Contact ASB</button>
                    </div>
                  </div>
                )}
              </>
            ) : cls.kind === "grain" ? (
              <div className="pc-class-imsbc">
                <span className="pc-class-desc">
                  {state.commodity?.grainCode || "Intl Grain Code"} · grain stability rules are checked against the vessel at matching, not here.
                </span>
              </div>
            ) : (
              <div style={{ marginTop: 10 }}>
                <PCSectionLabel>Packing · CSS break-bulk category</PCSectionLabel>
                <PCSelect
                  value={state.cssCategory}
                  onChange={(v) => set({ cssCategory: v })}
                  options={CSS_CATEGORIES.map(o => ({ value: o, label: o }))}
                  hint="Per the CSS Code break-bulk reference — mapped from the commodity, override if needed."
                />
                {cssMeta(state.cssCategory) && (
                  <PCNote kind="info"><strong>{cssMeta(state.cssCategory).id}</strong> securing: {cssMeta(state.cssCategory).securing}</PCNote>
                )}
              </div>
            )}

            {/* The other two classifiers are n/a by definition */}
            <div className="pc-na-row">
              {regime !== "GRAIN" && <span className="pc-na">Grain Code · n/a</span>}
              {regime !== "IMSBC" && <span className="pc-na">IMSBC Group · n/a</span>}
              {regime !== "CSS" && <span className="pc-na">CSS Category · n/a</span>}
            </div>

            {state.commodity?.form === "dual" && (
              <PCNote kind="info">
                Dual-form cargo, the <strong>Bulk / Break-Bulk</strong> toggle flips the live regime, {state.commodity?.grain ? "Bulk → Grain Code · Bagged → CSS securing." : "Bulk → IMSBC group · Bagged → CSS securing."}
              </PCNote>
            )}
          </>
        )}
      </PCCard>

      {/* CARD 3, Stowage factor — standard unit m³/t (auto-converts to ft³/t) */}
      <PCCard title="Stowage Factor (m³/t)">
        <div className="pc-sf-default">
          <div className="pc-sf-default__label">Platform default · m³/t</div>
          <div className="pc-sf-default__value">
            {sfDefault != null
              ? (sfCustom ? <span style={{ color: "var(--asb-amber)" }}>Custom SF</span> : `${round2(sfDefault / FT_PER_M3)} m³/t`)
              : "—"}
          </div>
        </div>
        <div className="pc-toggle-group" style={{ marginTop: 8 }}>
          <button type="button" className={`pc-toggle${isM3 ? " is-on" : ""}`} onClick={() => set({ sfUnit: "m3" })}>m³/t</button>
          <button type="button" className={`pc-toggle${!isM3 ? " is-on" : ""}`} onClick={() => set({ sfUnit: "ft" })}>ft³/t</button>
        </div>
        <div style={{ marginTop: 8 }}>
          <PCInput
            type="number"
            step={isM3 ? 0.01 : 0.1}
            value={sfDisplay}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (isNaN(v)) { set({ sf: null, sfCustom: true }); return; }
              set({ sf: isM3 ? v * FT_PER_M3 : v, sfCustom: true });
            }}
            placeholder={isM3 ? "e.g. 1.31" : "e.g. 47"}
          />
        </div>
        {state.sf != null && (
          <div className="pc-hint" style={{ marginTop: 6 }}>≈ {sfOther} · auto-converted</div>
        )}
        {sfCustom && (
          <PCNote kind="amber">
            Override only if you have a tested value. Platform uses default for volume matching.
          </PCNote>
        )}
        {state.commodity && state.sf > 50 && (
          <PCNote kind="info">Light cargo, volume check required against vessel hold capacity.</PCNote>
        )}
        {state.commodity && state.sf < 14 && state.sf > 0 && (
          <PCNote kind="amber">Heavy cargo, weight will limit before volume.</PCNote>
        )}
      </PCCard>

      {/* CARD 4, Form & Nature */}
      <PCCard title="Form & Nature" span={2}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          <div>
            <PCSectionLabel>{state.form === "break" ? "Packing · CSS break-bulk form" : "Packaging"}</PCSectionLabel>
            {state.form === "break" ? (
              <div className="pc-derived-block" style={{ background: "var(--asb-blue-light)" }}>
                <div className="pc-derived__k">CSS form</div>
                <div className="pc-derived__v" style={{ color: "var(--asb-navy)", fontSize: 14 }}>{state.cssCategory || "—"}</div>
                {cssMeta(state.cssCategory) && (
                  <div className="pc-defn" style={{ marginTop: 4 }}>Market names: {cssMeta(state.cssCategory).aliases}</div>
                )}
                <div className="pc-defn" style={{ marginTop: 4 }}>Chosen in <strong>Cargo classification</strong> above, per the CSS break-bulk reference.</div>
              </div>
            ) : (
              <>
                <div className="pc-chip-row">
                  {["Bulk", "Bagged", "Big Bags"].map(p => (
                    <PCChip key={p} active={state.packaging === p} onClick={() => set({ packaging: p })}>{p}</PCChip>
                  ))}
                </div>
                {state.commodity?.form === "dual" && (
                  <div className="pc-defn" style={{ marginTop: 8 }}>
                    {state.packaging === "Bulk"
                      ? "Bulk ticked → IMSBC group drives safety (see classification)."
                      : "Bagged / Big Bags ticked → CSS unit-load category drives securing."}
                  </div>
                )}
                {state.packaging === "Bagged" && (
                  <div style={{ marginTop: 10 }}>
                    <PCSectionLabel>Bag weight (kg) <span style={{ color: "var(--asb-red)" }}>· required</span></PCSectionLabel>
                    <PCInput type="number" placeholder="e.g. 50" value={state.bagWeight || ""} onChange={(e) => set({ bagWeight: e.target.value })} style={{ maxWidth: 160 }} />
                  </div>
                )}
              </>
            )}
          </div>
          <div>
            <PCSectionLabel>Nature</PCSectionLabel>
            <div className="pc-chip-row">
              {["Firm", "Subsale", "Indication"].map(n => (
                <PCChip key={n} active={state.nature === n} onClick={() => set({ nature: n })}>{n}</PCChip>
              ))}
            </div>
            <div className="pc-defn" style={{ marginTop: 8 }}>
              {state.nature === "Firm" && "Firm, Confirmed cargo, ready to fix."}
              {state.nature === "Subsale" && "Subsale, Cargo being resold through an intermediary."}
              {state.nature === "Indication" && "Indication, Freight idea only, not yet confirmed."}
            </div>
          </div>
        </div>
      </PCCard>

      {/* CARD 5, Quantity — moved into the Cargo step (“Cargo & Quantity”) */}
      <PCCard title="Quantity" span={1}>
        <div className="pc-qty-grid">
          <div className="pc-field--narrow">
            <PCSectionLabel>Min quantity (MT)</PCSectionLabel>
            <PCInput type="number" min={100} max={250000} placeholder="e.g. 3,000" value={state.minQty} onChange={(e) => set({ minQty: e.target.value })} />
          </div>
          <div className="pc-field--narrow">
            <PCSectionLabel>Max quantity (MT)</PCSectionLabel>
            <PCInput type="number" min={state.minQty || 100} max={250000} placeholder="e.g. 5,000" value={state.maxQty} onChange={(e) => set({ maxQty: e.target.value })} />
          </div>
          {minQ > 0 && maxQ > 0 && (
            <div className="pc-derived-block pc-qty-vol">
              <div className="pc-derived__k">Volume (auto, from SF)</div>
              <div className="pc-derived__v">{cbmMin} – {cbmMax} CBM</div>
            </div>
          )}
        </div>

        {maxQ > 15000 && (
          <PCNote kind="amber">Quantities above 15,000 MT may have limited vessel matches — this platform focuses on sub-15K DWT tonnage.</PCNote>
        )}

        <div className="pc-mol">
          <PCSectionLabel>MOL · More or Less Option</PCSectionLabel>
          <div className="row" style={{ gap: 8, marginTop: 4, flexWrap: "wrap", alignItems: "center" }}>
            <PCInput type="number" min={0} max={10} step={1} value={state.molPct} onChange={(e) => set({ molPct: e.target.value })} style={{ width: 64 }} />
            <span style={{ fontSize: 13, color: "var(--asb-ink)" }}>%</span>
            <PCChip active={state.molType === "MOLOO"} onClick={() => set({ molType: "MOLOO" })}>MOLOO</PCChip>
            <PCChip active={state.molType === "MOLCHOPT"} onClick={() => set({ molType: "MOLCHOPT" })}>MOLCHOPT</PCChip>
          </div>
          <div className="pc-defn" style={{ marginTop: 6 }}>
            MOLOO · Owner decides final quantity within ±%&nbsp;&nbsp;·&nbsp;&nbsp;MOLCHOPT · Charterer decides final quantity
          </div>
        </div>
      </PCCard>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2, PORTS
// ─────────────────────────────────────────────────────────────────────────────

function PortPicker({ idx, port, onPick, onClear, label, removable, status, setStatus }) {
  const [q, setQ] = React.useState("");
  const results = q ? searchPorts(q) : [];

  return (
    <div className={idx > 0 ? "pc-port-sub" : null}>
      {idx > 0 && (
        <div className="pc-port-sub__head">
          <span>{label}</span>
          {removable && <button type="button" className="pc-link pc-link--muted" onClick={onClear}>✕ Remove</button>}
        </div>
      )}
      <PCSearchBox
        value={port ? `${port.name} (${port.locode})` : q}
        onChange={(v) => { if (port) onClear(); setQ(v); }}
        placeholder="Type a port name or LOCODE — e.g. Novorossiysk or RUNVS"
        results={results}
        renderResult={(p) => {
          const m = window.ASB_portMeta(p);
          return (
            <div className="row-sb" style={{ width: "100%" }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: "var(--asb-navy)" }}>{m.name}</span>
              <span style={{ fontSize: 11, color: "var(--asb-gray-500)" }}>{m.locode} · {m.shortZone} · {m.country}</span>
            </div>
          );
        }}
        onPick={(p) => { onPick(portFromRaw(p)); setQ(""); }}
      />

      {port && (
        <>
          <div className="pc-defn" style={{ margin: "7px 0 2px" }}>LOCODE &amp; zone loaded automatically from the UN/LOCODE reference.</div>
          <div className="pc-derived-grid">
            <div><div className="pc-derived__k">Port name</div><div className="pc-derived__v">{port.name}</div></div>
            <div><div className="pc-derived__k">LOCODE</div><div className="pc-derived__v">{port.locode}</div></div>
            <div><div className="pc-derived__k">Country</div><div className="pc-derived__v">{port.country}</div></div>
            <div><div className="pc-derived__k">Zone</div><div className="pc-derived__v">{port.zone}<span style={{ color: "var(--asb-gray-500)", fontWeight: 400 }}> · {port.zoneFull}</span></div></div>
          </div>
          <div style={{ marginTop: 8 }}>
            <PCSectionLabel>Call status</PCSectionLabel>
            <div className="pc-chip-row">
              {["Confirmed", "Indicated", "TBA"].map(s => (
                <PCChip key={s} active={status === s} onClick={() => setStatus(s)}>{s}</PCChip>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Step2Ports({ state, set }) {
  const setPort = (which, idx, p) => {
    const arr = [...state[which]];
    arr[idx] = { ...arr[idx], port: p };
    set({ [which]: arr });
  };
  const setStatus = (which, idx, s) => {
    const arr = [...state[which]];
    arr[idx] = { ...arr[idx], status: s };
    set({ [which]: arr });
  };
  const addPort = (which) => {
    if (state[which].length >= 4) return;
    set({ [which]: [...state[which], { port: null, status: "Confirmed" }] });
  };
  const removePort = (which, idx) => {
    set({ [which]: state[which].filter((_, i) => i !== idx) });
  };

  // Route flag — derived from the zone CODE of the primary load/disch ports.
  const pol = state.pol[0]?.port;
  const pod = state.pod[0]?.port;
  let routeFlag = null;
  if (pol && pod) {
    const medBlack = ["EU-BLA", "EU-ADR", "EU-SEU", "AF-MED", "AF-NAF"];
    const eastOfSuez = ["ME-MID", "ME-IPB", "AS-SIN", "AS-NCN", "AS-SCN", "AS-JAP", "AF-EAF", "OC-OCE"];
    if (medBlack.includes(pol.zoneCode) && eastOfSuez.includes(pod.zoneCode))
      routeFlag = { kind: "amber", text: "⚠ Route crosses the Suez Canal — add transit toll and ~1 day to the voyage estimate." };
    else if (pol.zoneCode && pol.zoneCode === pod.zoneCode)
      routeFlag = { kind: "muted", text: "Short intra-zone voyage — port time will dominate the TCE." };
  }

  return (
    <div className="pc-grid pc-grid--2">
      {/* CARD 1, POL */}
      <PCCard
        title="Load Port (POL)"
        action={state.pol.length < 4 && <a className="pc-link" onClick={() => addPort("pol")}>+ Add {state.pol.length === 1 ? "2nd" : `port ${state.pol.length + 1}`} load port</a>}
      >
        {state.pol.map((p, i) => (
          <div key={i} style={{ marginTop: i === 0 ? 0 : 12 }}>
            <PortPicker
              idx={i}
              label={`Load Port ${i + 1}`}
              port={p.port}
              status={p.status}
              setStatus={(s) => setStatus("pol", i, s)}
              onPick={(np) => setPort("pol", i, np)}
              onClear={() => i === 0 ? setPort("pol", i, null) : removePort("pol", i)}
              removable={i > 0}
            />
          </div>
        ))}
        {routeFlag && state.pol[0]?.port && (
          <PCNote kind={routeFlag.kind === "amber" ? "amber" : "muted"} style={{ marginTop: 10 }}>{routeFlag.text}</PCNote>
        )}
      </PCCard>

      {/* CARD 2, POD */}
      <PCCard
        title="Discharge Port (POD)"
        action={state.pod.length < 4 && <a className="pc-link" onClick={() => addPort("pod")}>+ Add {state.pod.length === 1 ? "2nd" : `port ${state.pod.length + 1}`} disch port</a>}
      >
        {state.pod.map((p, i) => (
          <div key={i} style={{ marginTop: i === 0 ? 0 : 12 }}>
            <PortPicker
              idx={i}
              label={`Discharge Port ${i + 1}`}
              port={p.port}
              status={p.status}
              setStatus={(s) => setStatus("pod", i, s)}
              onPick={(np) => setPort("pod", i, np)}
              onClear={() => i === 0 ? setPort("pod", i, null) : removePort("pod", i)}
              removable={i > 0}
            />
          </div>
        ))}
      </PCCard>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3, LAYCAN & TERMS
// ─────────────────────────────────────────────────────────────────────────────

function Step3Terms({ state, set }) {
  const days = (() => {
    if (state.laycanMode === "spot" || !state.laycanFrom || !state.laycanTo) return null;
    const a = new Date(state.laycanFrom), b = new Date(state.laycanTo);
    const d = Math.round((b - a) / 86400000) + 1;
    return d > 0 ? d : null;
  })();

  return (
    <div className="pc-grid pc-grid--2">
      {/* CARD 1, Laycan & Laytime */}
      <PCCard title="Laycan & Laytime">
        <PCSectionLabel>Laycan</PCSectionLabel>
        <div style={{ marginTop: 4, maxWidth: 280 }}>
          <LaycanPicker
            value={{
              mode: state.laycanMode || "range",
              from: state.laycanFrom || null,
              to:   state.laycanTo   || null,
            }}
            onChange={(v) => set({
              laycanMode: v.mode,
              laycanFrom: v.from || "",
              laycanTo:   v.to   || "",
            })}
            placeholder="Click to set laycan…"
          />
        </div>

        {state.laycanMode !== "spot" && days != null && (
          <div className="pc-defn" style={{ marginTop: 8 }}>
            Window: <strong style={{ color: "var(--asb-ink)" }}>{days} day{days === 1 ? "" : "s"}</strong>
            {days <= 2 && <span style={{ color: "var(--asb-amber)" }}>  ⚠ Very tight, vessel must already be in position</span>}
            {days > 2 && days <= 5 && <span style={{ color: "var(--asb-amber)" }}>  ⚠ Tight window</span>}
            {days >= 15 && <span style={{ color: "var(--asb-green)" }}>  Wide laycan, good matching flexibility</span>}
          </div>
        )}
        {state.laycanMode === "spot" && (
          <PCNote kind="info" style={{ marginTop: 8 }}>SPOT cargo, open matching window applies. No laycan deadline.</PCNote>
        )}

        <div style={{ marginTop: 14 }}>
          <PCSectionLabel>Load terms</PCSectionLabel>
          <div className="pc-chip-row">
            {["FIOST", "FIO", "FIOT", "FIOS", "FI", "FO", "Liner Terms", "Gross Terms"].map(t => (
              <PCChip key={t} active={state.loadTerms === t} onClick={() => set({ loadTerms: t })}>{t}</PCChip>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <PCSectionLabel>Standard</PCSectionLabel>
          <div className="pc-chip-row">
            {["PWWD SHINC", "PWWD SHEX EIU", "PWWD SHEX UU", "PDPR"].map(t => (
              <PCChip key={t} active={state.laytime === t} onClick={() => set({ laytime: t })}>{t}</PCChip>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 10 }}>
          <PCSectionLabel>Friday countries  ·  Gulf · Red Sea · MENA</PCSectionLabel>
          <div className="pc-chip-row">
            {["PWWD FHINC", "PWWD FHEX EIU", "PWWD FHEX UU"].map(t => (
              <PCChip key={t} active={state.laytime === t} onClick={() => set({ laytime: t })}>{t}</PCChip>
            ))}
          </div>
        </div>

        <div className="pc-explainer" style={{ marginTop: 10 }}>
          EIU, Even If Used: time counts even if vessel works on excluded days.&nbsp;&nbsp;
          UU, Unless Used: time only counts if vessel actually works.&nbsp;&nbsp;
          FHEX / FHINC, Friday variants for ports where Friday is the weekly rest day.
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 14 }}>
          <div>
            <PCSectionLabel>Load rate (MT/day)</PCSectionLabel>
            <PCInput type="number" min={200} max={8000} placeholder="optional" value={state.loadRate} onChange={(e) => set({ loadRate: e.target.value })} />
            {state.loadRate > 5000 && <PCNote kind="amber">High load rate, verify ballasting operations at POL.</PCNote>}
          </div>
          <div>
            <PCSectionLabel>Discharge rate (MT/day)</PCSectionLabel>
            <PCInput type="number" min={200} max={8000} placeholder="optional" value={state.dischargeRate} onChange={(e) => set({ dischargeRate: e.target.value })} />
            {state.dischargeRate > 5000 && <PCNote kind="amber">High discharge rate, verify ballasting at POD.</PCNote>}
          </div>
        </div>
      </PCCard>

      {/* CARD 2, Freight, Commission & Demurrage */}
      <PCCard title="Freight, Commission & Demurrage">
        <PCSectionLabel>Freight idea (USD/MT)</PCSectionLabel>
        <PCInput type="number" min={1} max={500} placeholder="optional, e.g. 22" value={state.freightIdea} onChange={(e) => set({ freightIdea: e.target.value })} />
        {state.freightIdea && state.freightIdea < 10 && state.freightIdea > 0 && (
          <PCNote kind="red">Unrealistic, below minimum for any regional voyage.</PCNote>
        )}
        {state.freightIdea > 100 && (
          <PCNote kind="amber">Above typical bulk range, verify cargo type.</PCNote>
        )}

        <div style={{ marginTop: 10 }}>
          <PCSectionLabel>Freight basis</PCSectionLabel>
          <div className="pc-chip-row">
            {["Per MT", "Revenue Tonne", "Lumpsum", "BSS 1/1", "To be agreed"].map(b => (
              <PCChip key={b} active={state.freightBasis === b} onClick={() => set({ freightBasis: b })}>{b}</PCChip>
            ))}
          </div>
          {state.freightBasis === "Revenue Tonne" && (
            <PCNote kind="info">Revenue tonne = the higher of weight (MT) and volume (CBM), confirm SF before submitting.</PCNote>
          )}
        </div>

        <div className="pc-divider" />

        <PCSectionLabel>Total commission, TTL %</PCSectionLabel>
        <PCInput type="number" min={0} max={5} step={0.25} placeholder="e.g. 2.50" value={state.commission} onChange={(e) => set({ commission: e.target.value })} />
        <div className="pc-defn" style={{ marginTop: 4 }}>Total broker commission, Arab ShipBroker internal record.</div>
        {state.commission > 3.75 && <PCNote kind="amber">High commission, verify if address commission is included.</PCNote>}

        <div style={{ marginTop: 10 }}>
          <PCSectionLabel>Freight quoted IAC (including address commission)?</PCSectionLabel>
          <div className="pc-chip-row">
            <PCChip active={state.iac === "yes"} onClick={() => set({ iac: "yes" })}>Yes, IAC</PCChip>
            <PCChip active={state.iac === "no"} onClick={() => set({ iac: "no" })}>No, separate</PCChip>
          </div>
          <div className="pc-defn" style={{ marginTop: 4 }}>IAC = address commission already deducted from the quoted freight rate.</div>
        </div>

        <div className="pc-divider" />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <PCSectionLabel>Demurrage rate (USD/day)</PCSectionLabel>
            <PCInput type="number" min={0} max={10000} placeholder="optional" value={state.demRate} onChange={(e) => set({ demRate: e.target.value })} />
          </div>
          <div>
            <PCSectionLabel>Despatch rate (USD/day)</PCSectionLabel>
            <PCInput type="number" min={0} max={10000} placeholder="optional" value={state.despRate} onChange={(e) => set({ despRate: e.target.value })} />
            {state.demRate > 0 && (
              <PCNote kind="info">Typical despatch = half of demurrage = ${Math.round(state.demRate / 2)}/day.</PCNote>
            )}
            {state.demRate > 0 && !state.despRate && (
              <PCNote kind="amber">Despatch not set. Consider adding, it appears in every voyage charter party.</PCNote>
            )}
          </div>
        </div>
      </PCCard>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 4, SAFETY
// ─────────────────────────────────────────────────────────────────────────────

const LOAD_METHODS = ["Grab", "Conveyor belt", "Pneumatic", "Bucket elevator", "Screw conveyor", "Ship's gear", "Shore crane", "Manual", "Other"];

function Step4Safety({ state, set }) {
  const acls = activeClassification(state);
  const regime = acls?.regime || "IMSBC";
  const group = acls?.group || "C";
  const isGrain = regime === "GRAIN";
  const isCSS = regime === "CSS";

  const toggle = (key, v) => {
    const arr = state[key].includes(v) ? state[key].filter(x => x !== v) : [...state[key], v];
    set({ [key]: arr });
  };

  const groupColor = { A: "amber", B: "blue", C: "green", DG: "red" }[group] || "muted";

  return (
    <div className="pc-grid">
      <PCCard title="Cargo Safety Declaration">
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <RegimeChip regime={regime} noTip />
          {regime === "IMSBC" && <span className={`pc-imsbc-badge pc-imsbc-badge--${groupColor}`} style={{ margin: 0 }}>Group {group}</span>}
        </div>

        {regime === "IMSBC" && group === "C" && (
          <label className="pc-check">
            <input type="checkbox" checked={state.declC} onChange={(e) => set({ declC: e.target.checked })} />
            <span>I confirm this cargo presents no liquefaction or chemical hazard risk per IMSBC Group C. Standard bulk declaration is sufficient.</span>
          </label>
        )}

        {regime === "IMSBC" && group === "A" && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <PCSectionLabel>Moisture Content (MC %)</PCSectionLabel>
                <PCInput type="number" step={0.1} value={state.mc} onChange={(e) => set({ mc: e.target.value })} />
              </div>
              <div>
                <PCSectionLabel>Transportable Moisture Limit (TML %)</PCSectionLabel>
                <PCInput type="number" step={0.1} value={state.tml} onChange={(e) => set({ tml: e.target.value })} />
              </div>
            </div>
            {state.mc && state.tml && parseFloat(state.mc) >= parseFloat(state.tml) && (
              <PCNote kind="red">MC must be strictly less than TML, cargo cannot be loaded with current values.</PCNote>
            )}
            <div style={{ marginTop: 10 }}>
              <PCSectionLabel>TML / FMP Certificate <span style={{ color: "var(--asb-red)" }}>· required</span></PCSectionLabel>
              <div className="pc-upload">
                <span>📎 Drop file or browse, PDF / JPG</span>
                <button type="button" className="pc-link">Upload</button>
              </div>
            </div>
          </>
        )}

        {regime === "IMSBC" && group === "B" && (
          <>
            <PCSectionLabel>Does this cargo present self-heating or toxic gas risks?</PCSectionLabel>
            <div className="pc-chip-row">
              {["Yes", "No", "Unknown"].map(v => (
                <PCChip key={v} active={state.hazardB === v} onClick={() => set({ hazardB: v })}>{v}</PCChip>
              ))}
            </div>
            <label className="pc-check" style={{ marginTop: 10 }}>
              <input type="checkbox" checked={state.dgCert} onChange={(e) => set({ dgCert: e.target.checked })} />
              <span>I confirm a DG certificate on the vessel is required for this cargo.</span>
            </label>
          </>
        )}

        {isGrain && (
          <PCNote kind="info">
            <strong>Grain cargo.</strong> Grain stability — the vessel’s Document of Authorisation to Load Grain — is a <strong>vessel</strong> fact checked at matching (a grain cargo only fixes to a grain-authorised vessel). It is not declared here.
          </PCNote>
        )}

        {isCSS && (
          <PCNote kind="info">
            <strong>Break-bulk securing.</strong> Stowage &amp; securing follows the CSS category ({state.cssCategory || "—"}). Lashing and dunnage are agreed against the vessel’s Cargo Securing Manual at fixing.
          </PCNote>
        )}

        {/* CARGO-SIDE document (Part 4) — the shipper declares the cargo and its
            properties. This is the cargo side, distinct from any vessel cert. */}
        <div className="pc-decl-ref">
          <PCSectionLabel>Cargo document · shipper side</PCSectionLabel>
          <label className="pc-check" style={{ marginTop: 4 }}>
            <input type="checkbox" checked={state.shipperDecl} onChange={(e) => set({ shipperDecl: e.target.checked })} />
            <span>Listing references the <strong>Shipper’s Cargo Declaration</strong> — the shipper declaring this cargo and its properties{isGrain ? " (the cargo-side document for grain)" : ""}.</span>
          </label>
        </div>
      </PCCard>

      <PCCard title="Loading method">
        <div className="pc-chip-row">
          {LOAD_METHODS.map(m => (
            <PCChip key={m} active={state.loadMethods.includes(m)} onClick={() => toggle("loadMethods", m)}>{m}</PCChip>
          ))}
        </div>
      </PCCard>

      <PCCard title="Discharge method">
        <div className="pc-chip-row">
          {LOAD_METHODS.map(m => (
            <PCChip key={m} active={state.dischargeMethods.includes(m)} onClick={() => toggle("dischargeMethods", m)}>{m}</PCChip>
          ))}
        </div>
      </PCCard>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 5, REVIEW
// ─────────────────────────────────────────────────────────────────────────────

function ReviewRow({ k, v, auto }) {
  return (
    <div className="pc-review-row">
      <span className="pc-review-row__k">{k}</span>
      <span className={`pc-review-row__v${auto ? " is-auto" : ""}`}>{v || <span style={{ color: "var(--asb-gray-500)" }}>—</span>}</span>
    </div>
  );
}

function VisibilityCard({ value, onChange, org }) {
  return (
    <div className="pc-visibility">
      <div className="pc-visibility__label">Visibility</div>
      <p className="pc-visibility__q">Post for general circulation?</p>
      <p className="pc-visibility__sub">
        If yes, this listing circulates under <strong>{org.name}</strong>’s company desk
        — visible to Tier 3 and Tier 4 subscribers only. Enquiries route to the
        <strong> {org.desk.name}</strong> ({org.desk.email}); no individual’s direct line is ever shown.
      </p>
      <div className="pc-visibility__chips" role="radiogroup" aria-label="Circulation">
        <button
          type="button"
          role="radio"
          aria-checked={value === false}
          className={`pc-visibility__chip${value === false ? " is-on" : ""}`}
          onClick={() => onChange(false)}
        >Not for circulation</button>
        <button
          type="button"
          role="radio"
          aria-checked={value === true}
          className={`pc-visibility__chip${value === true ? " is-on" : ""}`}
          onClick={() => onChange(true)}
        >Yes, circulate under {org.name} desk</button>
      </div>
    </div>
  );
}

function Step5Review({ state, set, setStep }) {
  const polList = state.pol.filter(p => p.port).map(p => `${p.port.name} (${p.port.locode})`).join(" · ") || "—";
  const podList = state.pod.filter(p => p.port).map(p => `${p.port.name} (${p.port.locode})`).join(" · ") || "—";
  const lay = state.laycanMode === "spot" ? "SPOT, open" : (state.laycanFrom && state.laycanTo ? `${state.laycanFrom} → ${state.laycanTo}` : "—");
  const acls = activeClassification(state);
  const regime = acls?.regime;
  const regimeMeta = window.ASB_CARGO_CLASS?.regimeMeta?.[regime];
  const classifierVal = regime === "IMSBC" ? `Group ${acls.group}`
    : regime === "GRAIN" ? (state.commodity?.grainCode || "Grain Code")
    : (state.cssCategory || "—");

  // Org model — ownership + contact channel live on the company, not the person.
  const org = window.ASB_activeOrg();
  const me = window.ASB_currentMember();
  const typeLabel = window.ASB_TYPE_LABEL[org.type] || org.type;

  return (
    <>
      <div className="pc-grid">
        <PCCard title="Cargo" action={<a className="pc-link" onClick={() => setStep(0)}>Edit ←</a>}>
          <ReviewRow k="Commodity" v={state.unmapped ? state.newName : state.commodity?.name} auto={!state.unmapped} />
          <ReviewRow k="BCSN" v={state.unmapped ? "Pending classification" : state.commodity?.bcsn} auto={!state.unmapped} />
          <ReviewRow k="Regime" v={regimeMeta ? `${regimeMeta.label} · ${regimeMeta.code}` : null} auto />
          <ReviewRow k="Classifier" v={classifierVal} auto />
          <ReviewRow k="Form" v={state.form === "break" ? "Break-Bulk" : (state.grain ? "Bulk · Grain" : "Bulk")} />
          <ReviewRow k="Stowage factor" v={state.sf ? `${(state.sf / FT_PER_M3).toFixed(2)} m³/t  ·  ${Math.round(state.sf)} ft³/t` : null} auto={!state.sfCustom} />
          <ReviewRow k={state.form === "break" ? "Packing (CSS)" : "Packaging"} v={state.form === "break" ? state.cssCategory : (state.packaging + (state.packaging === "Bagged" && state.bagWeight ? ` · ${state.bagWeight} kg/bag` : ""))} />
          <ReviewRow k="Nature" v={state.nature} />
          <ReviewRow k="Quantity range" v={state.minQty && state.maxQty ? `${Number(state.minQty).toLocaleString()} – ${Number(state.maxQty).toLocaleString()} MT` : null} />
          <ReviewRow k="MOL" v={state.molPct ? `±${state.molPct}% ${state.molType}` : null} />
        </PCCard>

        <PCCard title="Ports" action={<a className="pc-link" onClick={() => setStep(1)}>Edit ←</a>}>
          <ReviewRow k="Load port(s)" v={polList} auto />
          <ReviewRow k="Discharge port(s)" v={podList} auto />
        </PCCard>

        <PCCard title="Laycan & Terms" action={<a className="pc-link" onClick={() => setStep(2)}>Edit ←</a>}>
          <ReviewRow k="Laycan" v={lay} />
          <ReviewRow k="Load terms" v={state.loadTerms} />
          <ReviewRow k="Laytime basis" v={state.laytime} />
          <ReviewRow k="Load / disch rate" v={(state.loadRate || state.dischargeRate) ? `${state.loadRate || "—"} / ${state.dischargeRate || "—"} MT/day` : null} />
          <ReviewRow k="Freight idea" v={state.freightIdea ? `USD ${state.freightIdea} ${state.freightBasis}` : null} />
          <ReviewRow k="Total commission" v={state.commission ? `${state.commission}%  ${state.iac === "yes" ? "(IAC)" : "(separate)"}` : null} />
          <ReviewRow k="Demurrage / Despatch" v={(state.demRate || state.despRate) ? `$${state.demRate || "—"} / $${state.despRate || "—"} per day` : null} />
        </PCCard>
      </div>

      <div className="pc-grid" style={{ marginTop: 12 }}>
        <PCCard title="Safety" action={<a className="pc-link" onClick={() => setStep(3)}>Edit ←</a>} span={3}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
            <div>
              <ReviewRow k="Regime" v={regimeMeta?.label} auto />
              <ReviewRow k="Classifier" v={classifierVal} auto />
              {regime === "GRAIN" && <ReviewRow k="Grain stability" v="Checked at matching (vessel)" />}
              {regime === "CSS" && <ReviewRow k="Securing" v={state.cssCategory} />}
              {regime === "IMSBC" && acls.group === "C" && <ReviewRow k="Group C declaration" v={state.declC ? "Confirmed" : "—"} />}
              {regime === "IMSBC" && acls.group === "A" && <ReviewRow k="MC / TML" v={`${state.mc || "—"}% / ${state.tml || "—"}%`} />}
              {regime === "IMSBC" && acls.group === "B" && <>
                <ReviewRow k="Self-heat / toxic risk" v={state.hazardB} />
                <ReviewRow k="DG certificate" v={state.dgCert ? "Required" : "—"} />
              </>}
              <ReviewRow k="Shipper's Cargo Declaration" v={state.shipperDecl ? "Referenced" : "—"} />
            </div>
            <div>
              <ReviewRow k="Loading methods" v={state.loadMethods.join(", ")} />
            </div>
            <div>
              <ReviewRow k="Discharge methods" v={state.dischargeMethods.join(", ")} />
            </div>
          </div>
        </PCCard>
      </div>

      <div className="pc-grid" style={{ marginTop: 12 }}>
        <PCCard title="Posted by" span={3}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
            <div>
              <ReviewRow k="Company" v={`${org.name} · ${typeLabel}`} auto />
              <ReviewRow k="Country" v={org.country} />
              <ReviewRow k="Subscription" v={org.tier} auto />
            </div>
            <div>
              <ReviewRow k="Handled by" v={`${me.name} · ${me.role}`} />
              <ReviewRow k="Desk contact" v={org.desk.name} auto />
            </div>
            <div>
              <ReviewRow k="Desk email" v={org.desk.email} auto />
              <ReviewRow k="Desk phone" v={org.desk.phone} auto />
            </div>
          </div>
          <PCNote kind="info">
            Counterparties see the <strong>{org.desk.name}</strong> only, flagged “handled by {me.name}”. Your personal line is never the marketplace channel — if you leave {org.name}, the listing stays with the firm.
          </PCNote>
        </PCCard>
      </div>

      <VisibilityCard
        value={state.forCirculation}
        onChange={(v) => set({ forCirculation: v })}
        org={org}
      />

      <button
        type="button"
        className="pc-submit"
        disabled={state.forCirculation === undefined || state.forCirculation === null}
        title={state.forCirculation == null ? "Choose a visibility option to continue" : undefined}
      >
        Submit for Arab ShipBroker review →
      </button>
      <div className="pc-privacy">
        All listing data is encrypted end-to-end. Visible only to Arab ShipBroker until your listing is approved.
        We never share your data with third parties.
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Root
// ─────────────────────────────────────────────────────────────────────────────

const INITIAL = {
  // step 1
  commodity: null, cargoType: "Dry Bulk", sf: 47, sfUnit: "m3", sfCustom: false,
  cssCategory: "Unit loads",
  packaging: "Bulk", bagWeight: "", nature: "Firm",
  // classification (Part 1) — Q1 form, Q2 grain, derived regime
  form: "bulk", grain: false, unmapped: false, newName: "",
  // Part 3 — adjustable hazard class (guarded) + soft-block state
  imsbcGroup: null, guard: null,
  // step 2
  pol: [{ port: null, status: "Confirmed" }],
  pod: [{ port: null, status: "Confirmed" }],
  minQty: "", maxQty: "", molPct: 5, molType: "MOLOO",
  // step 3
  laycanMode: "range", laycanFrom: "", laycanTo: "",
  loadTerms: "FIOST", laytime: "PWWD SHINC",
  loadRate: "", dischargeRate: "",
  freightIdea: "", freightBasis: "Per MT",
  commission: "2.50", iac: "no",
  demRate: "", despRate: "",
  // step 4
  declC: false, mc: "", tml: "", hazardB: "No", dgCert: false, grainBooklet: false,
  shipperDecl: false,
  loadMethods: [], dischargeMethods: [],
};

// ─────────────────────────────────────────────────────────────────────────────
// SMART PARSER, CARGO variant (one tab, cargo-specific fields)
// ─────────────────────────────────────────────────────────────────────────────

const CARGO_PARSER_FIELDS = [
  { k: "Commodity",            v: "Wheat (Bulk)",         found: true },
  { k: "Quantity min",         v: "8,000 MT",             found: true },
  { k: "Quantity max",         v: "10,000 MT",            found: true },
  { k: "MOL tolerance",        v: "5% MOLOO",             found: true },
  { k: "Load port (POL)",      v: "Novorossiysk (RUNER)", found: true },
  { k: "Discharge port (POD)", v: "Damietta (EGDAM)",     found: true },
  { k: "Laycan from",          v: "2026-04-14",           found: true },
  { k: "Laycan to",            v: "2026-04-18",           found: true },
  { k: "Load terms",           v: "FIOST",                found: true },
  { k: "Laytime",              v: "PWWD SHINC",           found: true },
  { k: "Load rate",            v: "—",                    found: false },
  { k: "Discharge rate",       v: "—",                    found: false },
  { k: "Freight idea",         v: "USD 28 / MT",          found: true },
  { k: "Freight basis",        v: "Per MT",               found: true },
  { k: "Commission (TTL)",     v: "2.50%",                found: true },
  { k: "Demurrage rate",       v: "—",                    found: false },
  { k: "Despatch rate",        v: "—",                    found: false },
  { k: "Stowage factor",       v: "1.31 m³/t (default)",   found: true },
  { k: "Cargo nature",         v: "—",                    found: false },
];

const CARGO_PARSER_PLACEHOLDER = `Paste cargo circular from WhatsApp or email here...

PLS OFFER FOR:
CARGO: WHEAT BULK
QTY: 8/10,000 MT 5% MOLOO
POL: 1-2 SB NOVOROSSIYSK
POD: 1 SB DAMIETTA
LAYCAN: 14/18 APR
LOAD TERMS: FIOST SHINC
FREIGHT IDEA: USD 28/MT
COMM: 1.25% + 1.25%`;

function SmartParserCargo({ panelState, setPanelState, onApply, embedded }) {
  const [text, setText] = React.useState("");
  const [extracted, setExtracted] = React.useState(false);

  const foundCount    = CARGO_PARSER_FIELDS.filter(f => f.found).length;
  const totalCount    = CARGO_PARSER_FIELDS.length;
  const notFoundCount = totalCount - foundCount;

  const reset = () => { setExtracted(false); setText(""); };

  // Collapsed launcher (floating only)
  if (!embedded && panelState === "strip") {
    return (
      <button type="button" className="pc-cparser__launch" onClick={() => setPanelState("expanded")} title="Open cargo parser">
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 7 L6 7 L8 4 L8 10 L10 7 L13 7" />
        </svg>
        Paste cargo circular
      </button>
    );
  }

  return (
    <aside className={`pc-cparser${embedded ? " pc-cparser--embedded" : ""}`}>
      <div className="pc-cparser__head">
        <span className="pc-cparser__title">
          <span className="pc-cparser__tile" aria-hidden="true">
            <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="#0D2545" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 7 L6 7 L8 4 L8 10 L10 7 L13 7" />
            </svg>
          </span>
          Paste cargo circular
        </span>
        {!embedded && (
          <button type="button" className="pc-cparser__x" onClick={() => setPanelState("strip")} title="Close">✕</button>
        )}
      </div>

      <div className="pc-cparser__body">
        {!extracted ? (
          <>
            <textarea
              className="pc-cparser__ta"
              placeholder="Paste cargo circular from WhatsApp or email…"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <button type="button" className="pc-cparser__btn" onClick={() => setExtracted(true)}>
              → Extract data
            </button>
            <div className="pc-cparser__cap">
              Pre-fills the form only. Nothing saved until you confirm, Arab ShipBroker never creates new commodities or ports; unmatched items are flagged for you to confirm.
            </div>
          </>
        ) : (
          <>
            <div className="pc-parser__results-header">
              <span>Extracted, <strong>{foundCount}</strong> of <strong>{totalCount}</strong> fields</span>
              <span className="pc-parser__not-found-count">{notFoundCount} not found</span>
            </div>
            <div className="pc-parser__results pc-cparser__results">
              {CARGO_PARSER_FIELDS.map(f => (
                <div key={f.k} className="pc-parser__field">
                  <span className="pc-parser__field-k">{f.k}</span>
                  <span className={`pc-parser__field-v${f.found ? " is-found" : " is-missing"}`}>
                    {f.found ? f.v : "Not found"}
                  </span>
                </div>
              ))}
            </div>
            <button type="button" className="pc-cparser__btn" style={{ marginTop: 10 }} onClick={() => { onApply(foundCount); reset(); }}>
              ✓ Apply all to form
            </button>
            <div className="pc-cparser__cap" style={{ textAlign: "center" }}>
              {notFoundCount} {notFoundCount === 1 ? "field" : "fields"} not found, complete manually.
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

function ParserUploadZone({ file, setFile, onExtract }) {
  const fileExt = (name) => {
    if (!name) return "";
    const m = /\.([^.]+)$/.exec(name);
    return m ? m[1].toLowerCase() : "";
  };
  const fileKind = (name) => {
    const ext = fileExt(name);
    if (ext === "pdf") return "pdf";
    if (ext === "xlsx" || ext === "xls") return "xls";
    if (ext === "docx" || ext === "doc") return "doc";
    return "other";
  };
  const onPick = (e) => {
    const f = e.target.files[0];
    if (f) setFile(f);
  };

  if (file) {
    const kind = fileKind(file.name);
    const label = kind === "pdf" ? "P" : kind === "xls" ? "X" : kind === "doc" ? "W" : "?";
    return (
      <>
        <div className="pc-parser__file">
          <span className={`pc-parser__file-icon is-${kind}`}>{label}</span>
          <span className="pc-parser__file-name">{file.name}</span>
          <button type="button" className="pc-parser__file-x" onClick={() => setFile(null)} title="Remove">✕</button>
        </div>
        <button type="button" className="pc-parser__action" onClick={onExtract}>
          <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M3 7 L11 7 M11 7 L8 4 M11 7 L8 10" />
          </svg>
          Extract data
        </button>
      </>
    );
  }

  return (
    <label className="pc-parser__upload">
      <input type="file" accept=".pdf,.xlsx,.xls,.docx,.doc" onChange={onPick} style={{ display: "none" }} />
      <div className="pc-parser__upload-icon">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#185FA5" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 16 L12 4" />
          <path d="M7 9 L12 4 L17 9" />
          <path d="M5 18 L19 18 L19 20 L5 20 Z" />
        </svg>
      </div>
      <div className="pc-parser__upload-title">Upload Q88 / Vessel Questionnaire</div>
      <div className="pc-parser__upload-sub">PDF  ·  Excel (.xlsx)  ·  Word (.docx)</div>
    </label>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Root
// ─────────────────────────────────────────────────────────────────────────────

window.PagePostCargo = function PagePostCargo() {
  const [step, setStep] = React.useState(0);
  const [state, setState] = React.useState(INITIAL);
  // Parser: state = "expanded" | "minimized" | "strip"
  const [parserState, setParserState] = React.useState("expanded");
  const [parserHeight, setParserHeight] = React.useState(Math.max(360, Math.round(window.innerHeight * 0.52)));
  const [parserMobileOpen, setParserMobileOpen] = React.useState(false);
  const [appliedCount, setAppliedCount] = React.useState(0);
  const set = (patch) => setState((s) => ({ ...s, ...patch }));

  // Org model — the company the signed-in user posts as (one company per person).
  const postOrg = window.ASB_activeOrg();
  const postMe = window.ASB_currentMember();

  // Unsaved-changes guard
  const isDirty = React.useMemo(() => {
    try { return JSON.stringify(state) !== JSON.stringify(INITIAL); }
    catch { return false; }
  }, [state]);
  useUnsavedGuard(isDirty, {
    onSave:    () => console.log("[ASB] Post Cargo, draft saved", state),
    onDiscard: () => { setState(INITIAL); setStep(0); setAppliedCount(0); },
  });

  const applyExtracted = (count) => {
    const wheat = COMMODITIES.find(c => c.market === "Wheat") || COMMODITIES[0];
    setState((s) => ({
      ...s,
      commodity: wheat,
      unmapped: false,
      cargoType: wheat.type,
      form: "bulk",
      grain: !!wheat.grain,
      sf: wheat.sf,
      sfUnit: "m3",
      sfCustom: false,
      pol: [{ port: portByLocode("RUNVS"), status: "Confirmed" }],
      pod: [{ port: portByLocode("EGDAM"), status: "Confirmed" }],
      minQty: "8000",
      maxQty: "10000",
      molPct: 5,
      molType: "MOLOO",
      laycanMode: "range",
      laycanFrom: "2026-04-14",
      laycanTo: "2026-04-18",
      loadTerms: "FIOST",
      laytime: "PWWD SHINC",
      freightIdea: "28",
      freightBasis: "Per MT",
      commission: "2.50",
    }));
    setAppliedCount(count);
  };

  const Body = [Step1Cargo, Step2Ports, Step3Terms, Step4Safety][step];

  return (
    <div className="pp-shell">
      <div className="pp-main">
        {/* Page header */}
        <div style={{ padding: "10px 20px", borderBottom: "var(--bd)", background: "var(--asb-white)" }}>
          <div className="row-sb">
            <div>
              <h1 className="page-title">Post Cargo</h1>
              <div className="eyebrow" style={{ marginTop: 2, whiteSpace: "nowrap" }}>Reviewed by Arab ShipBroker before publishing</div>
            </div>
            <div className="row" style={{ gap: 12, alignItems: "center" }}>
              <div className="pc-postas" title={`${postOrg.desk.name} · ${postOrg.desk.email}`}>
                <span className="pc-postas__k">Posting as</span>
                <span className="pc-postas__co">{postOrg.name}</span>
                <span className="pc-postas__meta">{(window.ASB_TYPE_LABEL[postOrg.type] || postOrg.type)} · {postOrg.tier}</span>
                <span className="pc-postas__by">You · {postMe.name}</span>
              </div>
              <button className="asb-btn ghost" type="button">Save draft &amp; exit</button>
            </div>
          </div>
        </div>

        <Stepper step={step} setStep={setStep} />

        <div className="pc-body">
          {appliedCount > 0 && (
            <div className="pc-applied-banner">
              <span className="pc-applied-banner__icon">✓</span>
              <span className="pc-applied-banner__text">
                Circular parsed, <strong>{appliedCount} fields applied</strong>. Review before submitting.
              </span>
              <button type="button" className="pc-applied-banner__close" onClick={() => setAppliedCount(0)} aria-label="Dismiss">✕</button>
            </div>
          )}
          {step < 4 ? <Body state={state} set={set} /> : <Step5Review state={state} set={set} setStep={setStep} />}
        </div>

        <div className="pc-footer">
          <button type="button" className="pc-btn pc-btn--ghost" disabled={step === 0} onClick={() => setStep(s => Math.max(0, s - 1))}>← Back</button>
          <div className="pc-footer__hint">
            {step < 4 ? `Step ${step + 1} of ${STEPS.length}` : "Review your listing, edit any section above"}
          </div>
          {step < 4 ? (
            <button type="button" className="pc-btn pc-btn--primary" onClick={() => setStep(s => Math.min(4, s + 1))}>
              Continue →
            </button>
          ) : (
            <button
              type="button"
              className="pc-btn pc-btn--primary"
              disabled={state.forCirculation === undefined || state.forCirculation === null}
              title={state.forCirculation == null ? "Choose a visibility option to continue" : undefined}
            >Submit →</button>
          )}
        </div>
      </div>

      {/* Floating compact cargo parser (desktop) */}
      <SmartParserCargo
        panelState={parserState}
        setPanelState={setParserState}
        onApply={applyExtracted}
      />

      {/* Mobile FAB + sheet */}
      <button type="button" className="pp-fab" onClick={() => setParserMobileOpen(true)} aria-label="Open Smart Parser">⚡</button>
      {parserMobileOpen && (
        <div className="pp-parser-mobile-overlay" onClick={() => setParserMobileOpen(false)}>
          <div className="pp-parser-mobile-sheet" onClick={(e) => e.stopPropagation()}>
            <SmartParserCargo
              embedded
              panelState="expanded"
              setPanelState={(s) => { if (s === "strip") setParserMobileOpen(false); }}
              onApply={(c) => { applyExtracted(c); setParserMobileOpen(false); }}
            />
          </div>
        </div>
      )}
    </div>
  );
};
