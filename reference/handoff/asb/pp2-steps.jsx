// asb/pp2-steps.jsx - Post Position (rebuild) step bodies + shared field helpers.
// Registered on window.PP2Steps; the shell (post-position2.jsx) looks each step up by id.
// Each entry: { render(ctx), summary(state)->string, complete(state)->bool }.
// ctx = { state, patch }. Composes ASB Design System components.
(function () {
  const { useState, useMemo } = React;
  const DS = window.ASBDesignSystem_0955c8 || {};
  const { Button, Input, Icon, StatusBadge, SegmentedToggle } = DS;
  const PP2 = window.PP2 || {};
  const GATE = PP2.SIZE_GATE_DWT || 66000;

  const fmt = (n) => (n == null || n === "" ? "-" : Number(n).toLocaleString("en-US"));
  const nf = (n) => (n == null || n === "" || isNaN(Number(n)) ? "-" : Number(n).toLocaleString("en-US"));

  // ── shared field primitives ──────────────────────────────────
  function Field({ label, req, help, htmlFor, full, children }) {
    return (
      <div className={"pp2-field" + (full ? " pp2-field--full" : "")}>
        <label className="pp2-label" htmlFor={htmlFor}>{label}{req && <span className="pp2-label__req">*</span>}{help && <span className="pp2-tip" tabIndex={0}><span className="pp2-tip__mark">!</span><span className="pp2-tip__bub">{help}</span></span>}</label>
        {children}
      </div>
    );
  }
  function Select({ value, onChange, options, placeholder, id }) {
    return (
      <select className="pp2-select" id={id} value={value || ""} onChange={(e) => onChange(e.target.value)}>
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => { const v = typeof o === "string" ? o : o.value; const l = typeof o === "string" ? o : o.label; return <option key={v} value={v}>{l}</option>; })}
      </select>
    );
  }
  const VTYPE_DEFS = {
    "General Cargo": "Multipurpose dry-cargo ship for bagged, packaged and break-bulk goods and light bulk. Usually geared, often with tween decks.",
    "Bulk Carrier": "Single-deck ship built to carry unpackaged dry bulk (grain, ore, coal, cement) loose in the hold.",
  };
  const CONFIG_DEFS = {
    "Geared Bulk Carrier": "Bulk carrier fitted with its own cranes or derricks, so it can load and discharge at berths that have no shore gear.",
    "Multi Purpose": "Flexible MPP vessel carrying a mix of general cargo, bulk, containers and project or heavy-lift pieces. Usually geared with box-shaped holds.",
    "Open Hatch": "Bulker with full-width box holds and hatches that open almost the full breadth, for vertical, damage-free loading of unitised cargo such as forest products and steel.",
  };
  const HATCH_DEFS = {
    "side-rolling": "Covers roll sideways on rails to open. Fast, gives a clear hatch; common on modern bulkers.",
    "folding": "Hinged panels that fold upright hydraulically. Quick to work, popular on handies.",
    "pontoon": "Separate portable slabs lifted on and off by crane. Simple but slower to open.",
    "lift-away": "Single-piece covers craned off and stowed ashore or on deck. Gives a fully open hatch.",
  };
  const STATUS_DEFS = {
    "Open": "Free and available to fix at the stated position and dates.",
    "Fixed": "Already committed to a charter. Shown for reference, not on offer.",
    "On Subs": "On subjects. A fixture is provisionally agreed, pending subjects being lifted.",
    "Ballast": "Sailing empty toward the open area. Not yet at the open port.",
    "Off-hire": "Temporarily out of service (repairs, survey). Not available.",
  };
  const CHARTER_DEFS = {
    "V/C": "Voyage charter. Owner carries a set cargo between named ports for freight per tonne or lumpsum.",
    "TCT": "Time-charter trip. Hired for a single trip, paid at a daily hire rate.",
    "T/C short": "Short-period time charter. Hired by the day for weeks or a few months.",
    "T/C long": "Long-period time charter. Hired by the day for many months or years.",
    "Bareboat": "Bareboat (demise) charter. Charterer takes full operational control and crews the ship.",
  };
  const FUEL_DEFS = {
    "VLSFO": "Very Low Sulphur Fuel Oil, max 0.50% sulphur. The IMO 2020 standard heavy fuel.",
    "LSMGO": "Low Sulphur Marine Gas Oil, max 0.10% sulphur. Distillate burned inside ECAs.",
    "HFO 380": "Heavy Fuel Oil at 380 cSt. High-sulphur residual; needs a scrubber to burn legally.",
    "MGO": "Marine Gas Oil. A clean distillate, dearer than the residual fuels.",
  };
  function SelectTip({ value, onChange, options, placeholder, defs, side }) {
    const [open, setOpen] = useState(false);
    const norm = options.map((o) => (typeof o === "string" ? { value: o, label: o } : o));
    const sel = norm.find((o) => o.value === value);
    return (
      <div className={"pp2-seltip" + (open ? " is-open" : "") + (side === "right" ? " pp2-seltip--right" : "")} tabIndex={0} onBlur={() => setOpen(false)}>
        <button type="button" className="pp2-select pp2-seltip__btn" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}>
          <span className={sel ? "" : "pp2-seltip__ph"}>{sel ? sel.label : (placeholder || "Select…")}</span>
          <span className="pp2-seltip__car" aria-hidden="true">▾</span>
        </button>
        {open && (
          <div className="pp2-seltip__menu" role="listbox">
            {norm.map((o) => (
              <button type="button" key={o.value} role="option" aria-selected={o.value === value} className={"pp2-optip" + (o.value === value ? " is-sel" : "")} onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(o.value); setOpen(false); }}>
                <span className="pp2-optip__code">{o.label}</span>
                {defs && defs[o.value] && <span className="pp2-optip__bub" role="tooltip">{defs[o.value]}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── company profile detail (Tier 3+ can view) ────────────────
  function CompanyDetail({ c }) {
    return (
      <div className="pp2-co">
        <div className="pp2-co__name">{c.name}</div>
        <div className="pp2-co__meta">{[c.country, c.imo ? "Co. IMO " + c.imo : null].filter(Boolean).join(" · ") || "Company"}</div>
        <div className="pp2-co__roles">
          <span className="pp2-co__role">Owns {c.owns}</span>
          <span className="pp2-co__role">Manages {c.managesComm}</span>
          <span className="pp2-co__role">ISM {c.ismManages}</span>
          <span className="pp2-co__role">Fleet {c.fleetTotal}</span>
        </div>
        {c.address ? <div className="pp2-co__row"><span>Address</span><span>{c.address}</span></div> : null}
        {c.contacts ? <div className="pp2-co__row"><span>Contacts</span><span>{c.contacts}</span></div> : null}
        {c.phone ? <div className="pp2-co__row"><span>Phone</span><span>{c.phone}</span></div> : null}
        {c.email ? <div className="pp2-co__row"><span>Email</span><span>{c.email}</span></div> : null}
        {c.linkNote ? <div className="pp2-co__note">{c.linkNote}</div> : null}
      </div>
    );
  }
  function LockedDetail({ c }) {
    return (
      <div className="pp2-co pp2-co--locked">
        <div className="pp2-co__name">{c.name}</div>
        <div className="pp2-co__meta">{c.country || "Company"}</div>
        <div className="pp2-lock">
          <div className="pp2-lock__t">Company profiles are a Tier 3 feature</div>
          <div className="pp2-lock__s">Address, contacts, phone and email unlock for Tier 3 and Tier 4 subscribers.</div>
        </div>
      </div>
    );
  }
  // ── ownership & management (Q88 five-tier chain, DB-searchable) ─
  function OwnershipBlock({ v, patch }) {
    const CO = window.PP2Companies;
    const [expanded, setExpanded] = useState(false);
    const [tier, setTier] = useState(4);
    const [open, setOpen] = useState(false);
    const [target, setTarget] = useState(null);
    const [q, setQ] = useState("");
    const [sel, setSel] = useState(null);
    if (!CO) return null;
    const canView = tier >= 3;
    const TIERS = [
      { key: "regOwner", label: "Registered owner" },
      { key: "parentGroup", label: "Parent group" },
      { key: "ismManager", label: "Technical operator" },
      { key: "manager", label: "Commercial operator / Manager" },
      { key: "disponentOwner", label: "Disponent owner" },
    ];
    const tierLabel = (k) => { const t = TIERS.find((x) => x.key === k); return t ? t.label : ""; };
    const results = CO.search(q, 40);
    const openSearch = (k) => { setTarget(k); setSel(v[k] ? CO.findByName(v[k]) : null); setQ(""); setOpen(true); };
    const openView = (co) => { setTarget(null); setSel(co); setQ(""); setOpen(true); };
    const assign = (co) => { if (patch && target) patch({ [target]: co.name }); setOpen(false); setTarget(null); };
    const owner = v.regOwner || null, mgr = v.manager || null;
    const summary = [owner ? "Owner " + owner : null, mgr ? "Mgr " + mgr : null].filter(Boolean).join(" · ") || "Not on file";
    const pips = (
      <span className="pp2-own__asrow">Viewing as{[1, 2, 3, 4].map((t) => <button key={t} type="button" className={"pp2-own__tierpip" + (tier === t ? " is-on" : "")} onClick={() => setTier(t)}>T{t}</button>)}</span>
    );
    return (
      <div className="pp2-own">
        <button type="button" className="pp2-own__bar" onClick={() => setExpanded((x) => !x)}>
          <span className="pp2-own__title">Ownership &amp; management</span>
          <span className="pp2-own__sum">{summary}</span>
          <span className="pp2-own__car">{expanded ? "Hide" : "Manage"}</span>
        </button>
        {expanded && !open && (
          <div className="pp2-own__body">
            <div className="pp2-own__tierhdr"><span>Q88 chain</span>{pips}</div>
            {TIERS.map((tr) => {
              const val = v[tr.key];
              const co = val && CO.findByName(val);
              return (
                <div className="pp2-own__tier" key={tr.key}>
                  <span className="pp2-own__k">{tr.label}</span>
                  <span className={"pp2-own__v" + (val ? "" : " is-empty")}>{val || "Not on file"}</span>
                  {val ? (canView
                    ? <button type="button" className="pp2-own__act" onClick={() => openView(co || { name: val, country: null })}>View</button>
                    : <span className="pp2-own__lock">Tier 3+</span>) : null}
                  {patch ? <button type="button" className="pp2-own__act pp2-own__act--ghost" onClick={() => openSearch(tr.key)}>{val ? "Change" : "Add"}</button> : null}
                </div>
              );
            })}
          </div>
        )}
        {expanded && open && (
          <div className="pp2-split2">
            <div className="pp2-split2__hd">
              <span className="pp2-split2__ttl">{target ? "Assign: " + tierLabel(target) : "Company profile"}</span>
              {pips}
              <button type="button" className="pp2-split2__x" onClick={() => { setOpen(false); setTarget(null); }}>Close</button>
            </div>
            <div className="pp2-split2__bd">
              <div className="pp2-split2__left">
                <input className="pp2-select pp2-split2__search" style={{ backgroundImage: "none" }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search companies…" />
                <div className="pp2-split2__list">
                  {results.map((c, ci) => (
                    <button type="button" key={c.name + ci} className={"pp2-split2__item" + (sel && sel.name === c.name ? " is-sel" : "")} onClick={() => setSel(c)}>
                      <span className="pp2-split2__cn">{c.name}</span>
                      <span className="pp2-split2__cm">{[c.country, "fleet " + c.fleetTotal].filter(Boolean).join(" · ")}</span>
                    </button>
                  ))}
                  {!results.length ? <div className="pp2-split2__empty">No match.</div> : null}
                </div>
              </div>
              <div className="pp2-split2__right">
                {!sel ? <div className="pp2-split2__empty">Select a company to view its profile.</div> : (canView ? <CompanyDetail c={sel} /> : <LockedDetail c={sel} />)}
                {sel && target && patch ? <button type="button" className="pp2-own__assign" onClick={() => assign(sel)}>Assign to {tierLabel(target)}</button> : null}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── vessel identity card (shown once a vessel is chosen/entered) ─
  function VesselCard({ v, onChange, patch }) {
    const dwt = Number(v.dwt) || 0;
    const over = dwt > GATE;
    const enriched = !!v.numHolds || !!v.serviceSpeed;
    return (
      <div className={"pp2-vcard" + (over ? " is-over" : "")}>
        <div className="pp2-vcard__top">
          <div className="pp2-vcard__idn">
            <div className="pp2-vcard__name">{v.name || "New vessel"}</div>
            <div className="pp2-vcard__imo">IMO {v.imo || "-"}{v.flag ? " · " + v.flag : ""}{v.built ? " · built " + v.built : ""}</div>
          </div>
          <div className="pp2-vcard__badges">
            {StatusBadge ? <StatusBadge status={v.verified ? "in" : "review"}>{v.verified ? "Verified" : "Unverified"}</StatusBadge> : null}
            {onChange && <button type="button" className="pp2-vcard__change" onClick={onChange}>Change</button>}
          </div>
        </div>
        <div className="pp2-vcard__stats">
          <div className="pp2-stat"><span className="pp2-stat__k">DWT</span><span className={"pp2-stat__v" + (over ? " is-alert" : "")}>{fmt(v.dwt)} MT</span></div>
          <div className="pp2-stat"><span className="pp2-stat__k">Type</span><span className="pp2-stat__v">{v.type || "-"}</span></div>
          <div className="pp2-stat"><span className="pp2-stat__k">LOA</span><span className="pp2-stat__v">{v.loa ? v.loa + " m" : "-"}</span></div>
          <div className="pp2-stat"><span className="pp2-stat__k">GRT</span><span className="pp2-stat__v">{fmt(v.grt)}</span></div>
          <div className="pp2-stat"><span className="pp2-stat__k">Class</span><span className="pp2-stat__v">{v.classSociety || "-"}</span></div>
        </div>
        {over && <div className="pp2-inline-note pp2-inline-note--alert">At {fmt(v.dwt)} MT this is over the {fmt(GATE)} DWT niche gate - Arab ShipBroker focuses on tonnage below this size.</div>}
        {!over && !v.verified && <div className="pp2-inline-note"><span className="pp2-inline-note__t">Usable right away - flagged <strong>Unverified</strong> until Arab ShipBroker confirms the record.</span></div>}
        {enriched && <div className="pp2-inline-note pp2-inline-note--ok">Cargo arrangement &amp; performance are on file for this vessel - pre-filled in the next steps.</div>}
        <OwnershipBlock v={v} patch={patch} />
      </div>
    );
  }

  // ── the Vessel step ──────────────────────────────────────────
  function VesselStep({ state, patch }) {
    const [q, setQ] = useState("");
    const rawMode = state.entryMode || "search";
    const mode = rawMode === "tbn" ? "tbn" : "search";
    const setMode = (m) => patch({ entryMode: m });

    const fleet = PP2.FLEET || [];
    const matches = useMemo(() => {
      const s = q.trim().toLowerCase();
      const list = s ? fleet.filter((v) => v.name.toLowerCase().includes(s) || String(v.imo).includes(s)) : fleet;
      return list.slice(0, 40);
    }, [q, fleet]);

    const chooseFleet = (v) => patch({ vessel: { ...v }, vesselImo: v.imo, arrangement: null });
    const clearVessel = () => patch({ vessel: null, vesselImo: null, arrangement: null });

    const startNew = () => {
      const digits = q.replace(/\D/g, "");
      const asImo = digits.length === 7 && PP2.imoCheckDigit(digits);
      patch({ vessel: { imo: asImo ? digits : "", name: asImo ? "" : q.trim().toUpperCase(), type: "Bulk Carrier", dwt: "", built: "", flag: "", grt: "", loa: "", classSociety: "", verified: false, source: "User entry" }, vesselImo: asImo ? digits : null, arrangement: null });
    };
    const openBosun = () => window.dispatchEvent(new CustomEvent("pp2-bosun-open"));
    const patchVessel = (u) => patch({ vessel: { ...(state.vessel || {}), ...u } });

    // TBN, full particulars minus identity (IMO, name)
    const tbn = state.tbn || { type: "Bulk Carrier", dwt: "", built: "", flag: "", loa: "", beam: "", draft: "", grt: "", classSociety: "" };
    const patchTbn = (u) => patch({ tbn: { ...tbn, ...u } });

    return (
      <div className="pp2-vessel">
        {!state.vessel && (
          <div className="pp2-spine">
            <div className="pp2-spine__ic">{Icon ? <Icon name="Vessel" size={22} /> : null}</div>
            <div className="pp2-spine__txt">
              <div className="pp2-spine__k">Vessel lookup</div>
              <div className="pp2-spine__h">Search by name or IMO, or add a new vessel</div>
            </div>
          </div>
        )}
        {SegmentedToggle ? (
          <SegmentedToggle
            className="pp2-modes"
            value={mode}
            onChange={(m) => { setMode(m); if (m !== "tbn") clearVessel(); }}
            options={[{ value: "search", label: "Search vessel" }, { value: "tbn", label: "TBN" }]}
          />
        ) : null}

        {/* MODE: search (fleet + registry, merged) */}
        {mode === "search" && !state.vessel && (
          <div className="pp2-fleet">
            {Input ? <Input search placeholder="Search by vessel name or IMO…" value={q} onChange={(e) => setQ(e.target.value)} /> : null}
            {!q.trim() ? (
              <div className="pp2-fleet__hint"><span>Start typing a vessel name or IMO to find her.</span></div>
            ) : matches.length > 0 ? (
              <div className="pp2-vlist">
                {matches.map((v) => (
                  <button type="button" className="pp2-vrow" key={v.imo} onClick={() => chooseFleet(v)}>
                    <span className="pp2-vrow__main">
                      <span className="pp2-vrow__name">{v.name}</span>
                      <span className="pp2-vrow__meta">IMO {v.imo} · {v.type} · {fmt(v.dwt)} MT{v.flag ? " · " + v.flag : ""}</span>
                    </span>
                    <span className="pp2-vrow__right">
                      {StatusBadge ? <StatusBadge status={v.verified ? "in" : "review"}>{v.verified ? "Verified" : "Unverified"}</StatusBadge> : null}
                      {Icon ? <Icon name="Caret" size={14} direction="right" /> : null}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="pp2-nomatch">
                <div className="pp2-nomatch__t">{Icon ? <Icon name="Vessel" size={16} /> : null} No vessel matches “{q.trim()}”.</div>
                <div className="pp2-nomatch__hint">Add her with a few essentials, or let Bosun read them off a Q88 or pasted details.</div>
                <div className="pp2-nomatch__actions">
                  <Button variant="primary" onClick={startNew}>Add “{q.trim()}”</Button>
                  <Button variant="secondary" onClick={openBosun}>Paste Q88 to Bosun</Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Identity capture for a brand-new vessel */}
        {mode === "search" && state.vessel && !PP2.findVesselByIMO(state.vessel.imo) && (
          <div className="pp2-newform">
            <VesselCard v={state.vessel} onChange={clearVessel} patch={patchVessel} />
            <div className="pp2-grid" style={{ marginTop: 14 }}>
              <Field label="IMO number" req help="7-digit permanent ship ID we build the vessel against."><input className="pp2-select" style={{ backgroundImage: "none", letterSpacing: ".04em", fontVariantNumeric: "tabular-nums" }} inputMode="numeric" maxLength={7} value={state.vessel.imo} onChange={(e) => patchVessel({ imo: e.target.value.replace(/\D/g, "").slice(0, 7) })} placeholder="e.g. 9235945" /></Field>
              <Field label="Vessel name" req help="Plain name, no MV / M/V prefix."><input className="pp2-select" style={{ backgroundImage: "none" }} value={state.vessel.name} onChange={(e) => patchVessel({ name: e.target.value.toUpperCase() })} placeholder="e.g. GULF TRADER" /></Field>
              <Field label="Vessel type" req help="The vessel category. Hover an option for its definition."><SelectTip value={state.vessel.type} onChange={(v) => patchVessel({ type: v })} options={PP2.ENUMS.vesselType} defs={VTYPE_DEFS} placeholder="Select…" /></Field>
              <Field label="DWT (MT)" req help="Deadweight in metric tonnes. Drives the size gate and the cargo match."><input className="pp2-select" style={{ backgroundImage: "none" }} inputMode="numeric" value={state.vessel.dwt} onChange={(e) => patchVessel({ dwt: e.target.value.replace(/[^\d]/g, "") })} placeholder="e.g. 8,200" /></Field>
              <Field label="Flag" req help="Flag state of registry."><input className="pp2-select" style={{ backgroundImage: "none" }} value={state.vessel.flag} onChange={(e) => patchVessel({ flag: e.target.value })} placeholder="e.g. Panama" /></Field>
              <Field label="Built"><input className="pp2-select" style={{ backgroundImage: "none" }} inputMode="numeric" maxLength={4} value={state.vessel.built} onChange={(e) => patchVessel({ built: e.target.value.replace(/\D/g, "").slice(0, 4) })} placeholder="e.g. 2006" /></Field>
              <Field label="LOA (m)"><input className="pp2-select" style={{ backgroundImage: "none" }} inputMode="decimal" value={state.vessel.loa} onChange={(e) => patchVessel({ loa: e.target.value.replace(/[^\d.]/g, "") })} placeholder="e.g. 120" /></Field>
            </div>
          </div>
        )}

        {/* Selected vessel from fleet/registry */}
        {state.vessel && !(mode === "search" && !PP2.findVesselByIMO(state.vessel.imo)) && (
          <VesselCard v={state.vessel} onChange={clearVessel} patch={patchVessel} />
        )}

        {/* MODE: TBN */}
        {mode === "tbn" && (
          <div className="pp2-tbn">
            <div className="pp2-inline-note">{Icon ? <Icon name="Vessel" size={14} /> : null}<span className="pp2-inline-note__t">To-be-nominated. Give her full particulars so charterers can match and estimate; only the IMO and name stay hidden until you have a fixture.</span></div>
            <div className="pp2-grid" style={{ marginTop: 12 }}>
              <Field label="Vessel type" req help="The vessel category. Hover an option for its definition."><SelectTip value={tbn.type} onChange={(v) => patchTbn({ type: v })} options={PP2.ENUMS.vesselType} defs={VTYPE_DEFS} placeholder="Select…" /></Field>
              <Field label="DWT (abt, MT)" req help="Approximate deadweight. Drives the size gate and the cargo match."><input className="pp2-select" style={{ backgroundImage: "none" }} inputMode="numeric" value={tbn.dwt} onChange={(e) => patchTbn({ dwt: e.target.value.replace(/[^\d]/g, "") })} placeholder="e.g. 12,000" /></Field>
              <Field label="Flag" req help="Flag state of registry."><input className="pp2-select" style={{ backgroundImage: "none" }} value={tbn.flag} onChange={(e) => patchTbn({ flag: e.target.value })} placeholder="e.g. Panama" /></Field>
              <Field label="Built"><input className="pp2-select" style={{ backgroundImage: "none" }} inputMode="numeric" maxLength={4} value={tbn.built} onChange={(e) => patchTbn({ built: e.target.value.replace(/\D/g, "").slice(0, 4) })} placeholder="e.g. 2010" /></Field>
              <Field label="LOA (m)"><input className="pp2-select" style={{ backgroundImage: "none" }} inputMode="decimal" value={tbn.loa} onChange={(e) => patchTbn({ loa: e.target.value.replace(/[^\d.]/g, "") })} placeholder="e.g. 140" /></Field>
              <Field label="Beam (m)"><input className="pp2-select" style={{ backgroundImage: "none" }} inputMode="decimal" value={tbn.beam} onChange={(e) => patchTbn({ beam: e.target.value.replace(/[^\d.]/g, "") })} placeholder="e.g. 22" /></Field>
              <Field label="Draft (m)"><input className="pp2-select" style={{ backgroundImage: "none" }} inputMode="decimal" value={tbn.draft} onChange={(e) => patchTbn({ draft: e.target.value.replace(/[^\d.]/g, "") })} placeholder="e.g. 9" /></Field>
              <Field label="GRT"><input className="pp2-select" style={{ backgroundImage: "none" }} inputMode="numeric" value={tbn.grt} onChange={(e) => patchTbn({ grt: e.target.value.replace(/[^\d]/g, "") })} placeholder="e.g. 9,600" /></Field>
              <Field label="Class society"><input className="pp2-select" style={{ backgroundImage: "none" }} value={tbn.classSociety} onChange={(e) => patchTbn({ classSociety: e.target.value })} placeholder="e.g. BV" /></Field>
            </div>
            {Number(tbn.dwt) > GATE && <div className="pp2-inline-note pp2-inline-note--alert" style={{ marginTop: 10 }}><span className="pp2-inline-note__t">DWT is over the {fmt(GATE)} niche gate.</span></div>}
          </div>
        )}
      </div>
    );
  }

  function vesselSummary(s) {
    if (s.entryMode === "tbn" && s.tbn) return "TBN · " + (s.tbn.type || "") + (s.tbn.dwt ? " · " + fmt(s.tbn.dwt) + " MT" : "");
    if (s.vessel) return s.vessel.name + " · IMO " + s.vessel.imo + " · " + fmt(s.vessel.dwt) + " MT" + (s.vessel.verified ? "" : " · Unverified");
    return "Not set";
  }
  function vesselComplete(s) {
    if (s.entryMode === "tbn") { const t = s.tbn; return !!(t && t.type && t.dwt && Number(t.dwt) > 0 && Number(t.dwt) <= GATE && t.flag); }
    if (!s.vessel) return false;
    const dwt = Number(s.vessel.dwt) || 0;
    return !!s.vessel.name && !!s.vessel.imo && dwt > 0 && dwt <= GATE;
  }

  function YesNo({ value, onChange }) {
    return SegmentedToggle ? <SegmentedToggle className="pp2-yn" value={value || ""} onChange={onChange} options={[{ value: "Y", label: "Yes" }, { value: "N", label: "No" }]} /> : null;
  }

  // ── the Cargo-arrangement step (5 human fields; pre-filled from a record) ─
  function ArrangementStep({ state, patch }) {
    const v = state.vessel;
    const isTBN = state.entryMode === "tbn";
    const [showFields, setShowFields] = useState(false);

    React.useEffect(() => {
      if (v && (v.numHolds || v.hatchType) && !state.arrangement) {
        patch({ arrangement: { numHolds: v.numHolds || "", numHatches: v.numHatches || v.numHolds || "", boxShaped: v.boxShaped || "", hatchType: v.hatchType || "", strengthenedHeavy: v.strengthenedHeavy || "", holdsMayBeEmpty: v.holdsMayBeEmpty || "", logFitted: v.logFitted || "", _source: "record" } });
      }
    }, [state.vessel]);

    const cur = state.arrangement || {};
    const patchA = (u) => patch({ arrangement: { ...cur, ...u, _source: "user" } });
    const fromRecord = cur._source === "record";
    const showForm = !fromRecord || showFields;
    const yn = (x, on, off) => (x === "Y" ? on : x === "N" ? off : null);
    const chips = [cur.config || null, cur.numHolds ? cur.numHolds + " holds" : null, yn(cur.boxShaped, "box-shaped", "not box-shaped"), cur.hatchType ? cur.hatchType + " hatches" : null, yn(cur.strengthenedHeavy, "heavy-strengthened", "not heavy-strengthened"), yn(cur.logFitted, "log-fitted", "not log-fitted")].filter(Boolean);

    return (
      <div className="pp2-arr">
        {isTBN && <div className="pp2-inline-note" style={{ marginTop: 0 }}><span className="pp2-inline-note__t">Even for a TBN listing the cargo arrangement is essential to match. Give the basics now; the vessel's identity stays hidden until you have a fixture.</span></div>}
        {fromRecord && <div className="pp2-inline-note pp2-inline-note--ok" style={{ marginTop: 0 }}><span className="pp2-inline-note__t">Read from <strong>{v.name}</strong>'s record on file - confirm or adjust.</span></div>}
        {fromRecord && !showFields && (
          <div className="pp2-arr-sum">
            <div className="pp2-arr-sum__chips">{chips.map((c, i) => <span className="pp2-arr-chip" key={i}>{c}</span>)}</div>
            <button type="button" className="pp2-vcard__change" onClick={() => setShowFields(true)}>Adjust</button>
          </div>
        )}
        {showForm && (
          <div className="pp2-grid" style={{ marginTop: fromRecord || isTBN ? 14 : 4 }}>
            <Field label="Vessel Configuration" help="Special design types (geared, multipurpose, open-hatch). Leave blank for a standard bulker or general-cargo ship. Hover an option for its definition."><SelectTip value={cur.config} onChange={(x) => patchA({ config: x })} options={PP2.ENUMS.vesselConfig} defs={CONFIG_DEFS} placeholder="Standard — none of these" /></Field>
            <Field label="Number Of Holds" req help="Holds = hatches by default."><input className="pp2-select" style={{ backgroundImage: "none", maxWidth: 120 }} inputMode="numeric" value={cur.numHolds || ""} onChange={(e) => patchA({ numHolds: e.target.value.replace(/\D/g, "").slice(0, 1) })} placeholder="e.g. 2" /></Field>
            <Field label="Number Of Hatches" help="Override only - blank = same as holds."><input className="pp2-select" style={{ backgroundImage: "none", maxWidth: 120 }} inputMode="numeric" value={cur.numHatches || ""} onChange={(e) => patchA({ numHatches: e.target.value.replace(/\D/g, "").slice(0, 1) })} placeholder={cur.numHolds || "-"} /></Field>
            <Field label="Box-Shaped Holds" req help="Clean stow for containers, steel, packaged cargo."><YesNo value={cur.boxShaped} onChange={(x) => patchA({ boxShaped: x })} /></Field>
            <Field label="Hatch Type" req help="Hatch cover design. Hover an option for its definition."><SelectTip value={cur.hatchType} onChange={(x) => patchA({ hatchType: x })} options={PP2.ENUMS.hatchType} defs={HATCH_DEFS} placeholder="Select…" /></Field>
            <Field label="Strengthened For Heavy Cargo" req help="Tank-top strengthened for dense cargo (ore, steel)."><YesNo value={cur.strengthenedHeavy} onChange={(x) => patchA({ strengthenedHeavy: x })} /></Field>
            <Field label="Holds May Be Left Empty" help="Alternate-hold loading for heavy parcels."><YesNo value={cur.holdsMayBeEmpty} onChange={(x) => patchA({ holdsMayBeEmpty: x })} /></Field>
            <Field label="Fitted For Logs" req help="Stanchions for log / timber trades."><YesNo value={cur.logFitted} onChange={(x) => patchA({ logFitted: x })} /></Field>
          </div>
        )}
      </div>
    );
  }
  function arrSummary(s) {
    const a = s.arrangement || {}; const parts = [a.config || null, a.numHolds ? a.numHolds + " holds" : null, a.hatchType || null, a.strengthenedHeavy === "Y" ? "heavy-strengthened" : null].filter(Boolean);
    return parts.length ? parts.join(" · ") : "Not set";
  }
  function arrComplete(s) {
    const a = s.arrangement; if (!a) return false; if (a._source === "record") return true;
    return !!(a.numHolds && a.boxShaped && a.hatchType && a.strengthenedHeavy && a.logFitted);
  }

  // ── shared: searchable port picker (reused by Post Cargo too) ─
  function PortPicker({ value, onChange, placeholder }) {
    const [q, setQ] = useState("");
    const [open, setOpen] = useState(false);
    const results = useMemo(() => PP2.findPorts(q, 8), [q]);
    if (value && value.locode && !open) {
      return (
        <div className="pp2-port-sel">
          <span className="pp2-port-sel__name">{value.name}</span>
          <span className="pp2-port-sel__loc">{value.locode}{value.zoneName ? " · " + value.zoneName : ""}</span>
          <button type="button" className="pp2-vcard__change" onClick={() => { setOpen(true); setQ(""); }}>Change</button>
        </div>
      );
    }
    return (
      <div className="pp2-port">
        <input className="pp2-select" style={{ backgroundImage: "none" }} value={q} placeholder={placeholder || "Search port or LOCODE…"} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} />
        {open && q && (
          <div className="pp2-port__menu">
            {results.map((p) => (
              <button type="button" className="pp2-port__opt" key={p.locode} onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(p); setOpen(false); setQ(""); }}>
                <span className="pp2-port__opt-name">{p.name}</span>
                <span className="pp2-port__opt-meta">{p.locode} · {p.zoneName || p.zone}{p.country ? " · " + p.country : ""}</span>
              </button>
            ))}
            {results.length === 0 && <div className="pp2-port__empty">No port matches “{q}”.</div>}
          </div>
        )}
      </div>
    );
  }

  function ZoneChips({ value = [], onChange }) {
    const toggle = (z) => onChange(value.includes(z) ? value.filter((x) => x !== z) : [...value, z]);
    return <div className="pp2-chips">{PP2.ENUMS.tradingZone.map((z) => <button type="button" key={z} className={"pp2-chip-toggle" + (value.includes(z) ? " is-on" : "")} onClick={() => toggle(z)}>{z}</button>)}</div>;
  }

  // ── the Availability step ────────────────────────────────────
  const TODAY = new Date().toISOString().slice(0, 10);
  const addDays = (d, n) => { const dt = new Date(d + "T00:00:00"); dt.setDate(dt.getDate() + n); return dt.toISOString().slice(0, 10); };
  const diffDays = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

  function AvailabilityStep({ state, patch }) {
    const av = state.availability || {};
    const patchAv = (u) => patch({ availability: { ...av, ...u } });
    const isTC = av.charterType === "T/C short" || av.charterType === "T/C long" || av.charterType === "Bareboat";
    return (
      <div className="pp2-avail">
        <div className="pp2-grid">
          <Field label="Status" req help="Where she stands right now. Hover an option for its definition."><SelectTip value={av.status} onChange={(x) => patchAv({ status: x })} options={PP2.ENUMS.status} defs={STATUS_DEFS} placeholder="Select…" /></Field>
          <Field label="Charter type" help={isTC ? "Disponent operator - Arab ShipBroker quietly confirms the charter is valid before fixing." : "How she currently trades. Owner and manager often differ, which is normal."}><SelectTip value={av.charterType} onChange={(x) => patchAv({ charterType: x })} options={PP2.ENUMS.charterType} defs={CHARTER_DEFS} placeholder="Select…" /></Field>
          <Field label="Open port" req help="Where she becomes free. Resolves to a UN/LOCODE."><PortPicker value={av.openPort} onChange={(p) => patchAv({ openPort: p })} /></Field>
          <Field label="Zone" help="Derived from the open port.">{av.openPort && av.openPort.zoneName ? <span className="pp2-derived">{av.openPort.zoneName}</span> : <span className="pp2-derived is-empty">-</span>}</Field>
          <Field label="Open from" req help="Earliest date she's free."><input type="date" className="pp2-select" style={{ backgroundImage: "none" }} min={TODAY} value={av.openFrom || ""} onChange={(e) => patchAv({ openFrom: e.target.value })} /></Field>
        </div>
        <Field full label="Trading zones" help="Regions she'll trade. Red Sea North &amp; South are separate." ><ZoneChips value={av.zones} onChange={(z) => patchAv({ zones: z })} /></Field>
        <Field full label="Next direction / preference" help="Where she would prefer to trade next. Guides matching."><input className="pp2-select" style={{ backgroundImage: "none" }} value={av.direction || ""} onChange={(e) => patchAv({ direction: e.target.value })} placeholder="e.g. prompt Red Sea; prefers Med redelivery" /></Field>
        <label className="pp2-wog">{DS.Toggle ? <DS.Toggle checked={!!av.wog} onChange={(e) => patchAv({ wog: e.target.checked })} /> : null}<span className="pp2-wog__label">Rates without guarantee (WOG)</span></label>
        <div className="pp2-wog__hint">Position details shown as indication only, subject to reconfirmation.</div>
      </div>
    );
  }
  function avSummary(s) {
    const a = s.availability || {}; if (!a.status && !a.openPort) return "Not set";
    return [a.status || null, a.openPort ? a.openPort.name + " (" + a.openPort.locode + ")" : null, a.openFrom ? "from " + a.openFrom : null].filter(Boolean).join(" · ");
  }
  function avComplete(s) {
    const a = s.availability; if (!a) return false;
    if (!a.status || !a.openPort || !a.openPort.locode || !a.openFrom) return false;
    return true;
  }

  // ── shared: number input with unit suffix ────────────────────
  function NumInput({ value, onChange, placeholder, unit, decimal, max }) {
    return (
      <div className="pp2-num">
        <input className="pp2-select" style={{ backgroundImage: "none" }} inputMode={decimal ? "decimal" : "numeric"} value={value == null ? "" : value}
          onChange={(e) => { let v = e.target.value.replace(decimal ? /[^\d.]/g : /[^\d]/g, ""); if (max != null && Number(v) > max) v = String(max); onChange(v); }} placeholder={placeholder} />
        {unit && <span className="pp2-num__unit">{unit}</span>}
      </div>
    );
  }

  // ── the Performance step (lean voyage-calc model) ────────────
  function PerformanceStep({ state, patch }) {
    const v = state.vessel;
    const perf = state.performance || {};
    const patchP = (u) => patch({ performance: { ...perf, ...u, _source: "user" } });
    React.useEffect(() => {
      if (v && v.serviceSpeed && !state.performance) {
        patch({ performance: { serviceSpeed: v.serviceSpeed, meConsSea: v.meConsSea || "", meConsPort: v.meConsPort || "", auxConsPort: v.auxConsPort || "", fuelType: v.fuelType || "VLSFO", brob: v.brob || "", scrubber: !!v.scrubber, eco: false, _source: "record" } });
      }
    }, [state.vessel]);
    const fromRecord = perf._source === "record";
    return (
      <div className="pp2-perf">
        <div className="pp2-inline-note" style={{ marginTop: 0 }}>{Icon ? <Icon name="VoyCalc" size={14} /> : null}<span className="pp2-inline-note__t">Feeds the voyage estimate. {fromRecord ? "Read from the vessel's record, confirm or adjust." : "A best-guess is fine, Bosun can refine it from the Q88 later."}</span></div>
        <div className="pp2-grid" style={{ marginTop: 14 }}>
          <Field label="Service speed" req help="Laden, good weather."><NumInput value={perf.serviceSpeed} onChange={(x) => patchP({ serviceSpeed: x })} unit="kn" decimal placeholder="e.g. 12.5" /></Field>
          <Field label="Fuel type" req help="Main bunker grade she burns. Hover an option for its definition."><SelectTip value={perf.fuelType} onChange={(x) => patchP({ fuelType: x })} options={PP2.ENUMS.fuelType} defs={FUEL_DEFS} placeholder="Select…" /></Field>
          <Field label="ME consumption at sea" req help="Main engine, per day at service speed."><NumInput value={perf.meConsSea} onChange={(x) => patchP({ meConsSea: x })} unit="MT/d" decimal placeholder="e.g. 24" /></Field>
          <Field label="ME consumption in port" help="Main engine, working / idle."><NumInput value={perf.meConsPort} onChange={(x) => patchP({ meConsPort: x })} unit="MT/d" decimal placeholder="e.g. 2" /></Field>
          <Field label="AUX consumption in port" help="Generators while in port."><NumInput value={perf.auxConsPort} onChange={(x) => patchP({ auxConsPort: x })} unit="MT/d" decimal placeholder="e.g. 1.5" /></Field>
          <Field label="Bunkers ROB" help="Remaining on board at the open position."><NumInput value={perf.brob} onChange={(x) => patchP({ brob: x })} unit="MT" placeholder="e.g. 120" /></Field>
        </div>
        <div className="pp2-toggles">
          <label className="pp2-wog">{DS.Toggle ? <DS.Toggle checked={!!perf.scrubber} onChange={(e) => patchP({ scrubber: e.target.checked })} /> : null}<span className="pp2-wog__label">Scrubber fitted</span></label>
          <label className="pp2-wog">{DS.Toggle ? <DS.Toggle checked={!!perf.eco} onChange={(e) => patchP({ eco: e.target.checked })} /> : null}<span className="pp2-wog__label">ECA-compliant on low-sulphur</span></label>
        </div>
      </div>
    );
  }
  function perfSummary(s) {
    const p = s.performance || {}; if (!p.serviceSpeed && !p.meConsSea) return "Optional, not set";
    return [p.serviceSpeed ? p.serviceSpeed + " kn" : null, p.meConsSea ? p.meConsSea + " MT/d sea" : null, p.fuelType || null].filter(Boolean).join(" · ");
  }
  function perfComplete() { return true; } // performance is advisory; never blocks

  // ── the Gear step (dependency on geared) ─────────────────────
  function GearStep({ state, patch }) {
    const v = state.vessel;
    const gear = state.gear || {};
    const patchG = (u) => patch({ gear: { ...gear, ...u, _source: "user" } });
    React.useEffect(() => {
      if (v && v.isGeared && !state.gear) {
        const geared = v.isGeared === "Y";
        patch({ gear: { geared, craneCount: v.craneCount || "", craneSwl: v.craneSwl || "", grabs: !!v.numGrabs, numGrabs: v.numGrabs || "", grabCapacity: v.grabCapacity || "", _source: "record" } });
      }
    }, [state.vessel]);
    const geared = gear.geared;
    const setGeared = (val) => patchG({ geared: val });
    return (
      <div className="pp2-gear">
        <Field label="Gear" req help="Cranes/derricks aboard, or gearless (shore cranes only).">
          {SegmentedToggle ? <SegmentedToggle className="pp2-yn" value={geared == null ? "" : geared ? "geared" : "gearless"} onChange={(x) => setGeared(x === "geared")} options={[{ value: "geared", label: "Geared" }, { value: "gearless", label: "Gearless" }]} /> : null}
        </Field>
        {geared && (
          <div className="pp2-grid" style={{ marginTop: 15 }}>
            <Field label="Number of cranes" req help="Cranes or derricks aboard."><NumInput value={gear.craneCount} onChange={(x) => patchG({ craneCount: x })} unit="×" placeholder="e.g. 4" max={4} /></Field>
            <Field label="SWL per crane" req help="Safe working load."><NumInput value={gear.craneSwl} onChange={(x) => patchG({ craneSwl: x })} unit="MT" decimal placeholder="e.g. 30" /></Field>
          </div>
        )}
        {geared && (
          <label className="pp2-wog" style={{ marginTop: 14 }}>{DS.Toggle ? <DS.Toggle checked={!!gear.grabs} onChange={(e) => patchG({ grabs: e.target.checked })} /> : null}<span className="pp2-wog__label">Grabs fitted</span></label>
        )}
        {geared && gear.grabs && (
          <div className="pp2-grid" style={{ marginTop: 12 }}>
            <Field label="Number of grabs" help="Grabs aboard for self-discharge."><NumInput value={gear.numGrabs} onChange={(x) => patchG({ numGrabs: x })} unit="×" placeholder="e.g. 2" max={5} /></Field>
            <Field label="Grab capacity" help="Volume each grab lifts."><NumInput value={gear.grabCapacity} onChange={(x) => patchG({ grabCapacity: x })} unit="m³" decimal placeholder="e.g. 8" /></Field>
          </div>
        )}
        {geared && (
          <label className="pp2-wog" style={{ marginTop: 14 }}>{DS.Toggle ? <DS.Toggle checked={!!gear.kickPlate} onChange={(e) => patchG({ kickPlate: e.target.checked })} /> : null}<span className="pp2-wog__label">Kick-plate fitted</span></label>
        )}
        {geared === false && <div className="pp2-inline-note">{Icon ? <Icon name="Anchor" size={14} /> : null}<span className="pp2-inline-note__t">Gearless, she'll rely on shore cranes at the load and discharge ports.</span></div>}
      </div>
    );
  }
  function gearSummary(s) {
    const g = s.gear; if (!g || g.geared == null) return "Not set";
    if (!g.geared) return "Gearless";
    return [g.craneCount ? g.craneCount + " cranes" : "Geared", g.craneSwl ? g.craneSwl + " MT SWL" : null, g.grabs ? "grabs" : null, g.kickPlate ? "kick-plate" : null].filter(Boolean).join(" · ");
  }
  function gearComplete(s) {
    const g = s.gear; if (!g || g.geared == null) return false;
    if (g.geared) return !!(g.craneCount && g.craneSwl);
    return true;
  }

  // ── the Review step ──────────────────────────────────────────
  function ReviewRow({ label, value, alert }) {
    return <div className="pp2-rev__row"><span className="pp2-rev__k">{label}</span><span className={"pp2-rev__v" + (alert ? " is-alert" : "")}>{value || "-"}</span></div>;
  }
  function ReviewStep({ state }) {
    const v = state.vessel; const a = state.availability || {}; const arr = state.arrangement || {}; const p = state.performance || {}; const g = state.gear || {};
    const isTBN = state.entryMode === "tbn";
    const dwt = Number(v && v.dwt) || 0; const over = dwt > (PP2.SIZE_GATE_DWT || 66000);
    const yn = (x) => (x === "Y" ? "Yes" : x === "N" ? "No" : "-");
    return (
      <div className="pp2-rev">
        {!isTBN && v && !v.verified && <div className="pp2-inline-note" style={{ marginTop: 0 }}><span className="pp2-inline-note__t">This position will post immediately, flagged <strong>Unverified</strong> until Arab ShipBroker confirms the vessel record.</span></div>}
        {over && <div className="pp2-inline-note pp2-inline-note--alert" style={{ marginTop: isTBN ? 0 : 12 }}><span className="pp2-inline-note__t">DWT is over the {nf(PP2.SIZE_GATE_DWT || 66000)} niche gate, this position cannot be posted.</span></div>}

        <div className="pp2-rev__card">
          <div className="pp2-rev__head">{isTBN ? "TBN" : (v && v.name)}{!isTBN && v && (v.verified ? <StatusBadge status="in">Verified</StatusBadge> : <StatusBadge status="review">Unverified</StatusBadge>)}</div>
          <div className="pp2-rev__grid">
            {isTBN ? <><ReviewRow label="Type" value={state.tbn && state.tbn.type} /><ReviewRow label="DWT" value={nf(state.tbn && state.tbn.dwt) + " MT"} /><ReviewRow label="Flag" value={state.tbn && state.tbn.flag} /><ReviewRow label="LOA / Beam" value={state.tbn && state.tbn.loa ? (state.tbn.loa + " m" + (state.tbn.beam ? " / " + state.tbn.beam + " m" : "")) : null} /><ReviewRow label="Built" value={state.tbn && state.tbn.built} /><ReviewRow label="Class" value={state.tbn && state.tbn.classSociety} /></> : <><ReviewRow label="IMO" value={v && v.imo} /><ReviewRow label="DWT" value={nf(dwt) + " MT"} alert={over} /><ReviewRow label="Type" value={v && v.type} /><ReviewRow label="Flag" value={v && v.flag} /></>}
          </div>
        </div>

        {<div className="pp2-rev__card">
          <div className="pp2-rev__sub">Cargo Arrangement</div>
          <div className="pp2-rev__grid">
            <ReviewRow label="Configuration" value={arr.config} />
            <ReviewRow label="Holds / Hatches" value={(arr.numHolds || "-") + "H / " + (arr.numHatches || arr.numHolds || "-") + "Ha"} />
            <ReviewRow label="Box-Shaped" value={yn(arr.boxShaped)} />
            <ReviewRow label="Hatch Type" value={arr.hatchType} />
            <ReviewRow label="Heavy-Strengthened" value={yn(arr.strengthenedHeavy)} />
            <ReviewRow label="Log-Fitted" value={yn(arr.logFitted)} />
          </div>
        </div>}

        <div className="pp2-rev__card">
          <div className="pp2-rev__sub">Availability</div>
          <div className="pp2-rev__grid">
            <ReviewRow label="Status" value={a.status} />
            <ReviewRow label="Open Port" value={a.openPort ? a.openPort.name + " (" + a.openPort.locode + ")" : null} />
            <ReviewRow label="Open From" value={a.openFrom || null} />
            <ReviewRow label="Zone" value={a.openPort && a.openPort.zoneName} />
            <ReviewRow label="Charter" value={a.charterType} />
            <ReviewRow label="Terms" value={a.wog ? "WOG" : "Firm"} />
          </div>
          {(a.zones && a.zones.length > 0) && <div className="pp2-rev__chips">{a.zones.map((z) => <span className="pp2-arr-chip" key={z}>{z}</span>)}</div>}
        </div>

        <div className="pp2-rev__card">
          <div className="pp2-rev__sub">Performance &amp; Gear</div>
          <div className="pp2-rev__grid">
            <ReviewRow label="Service Speed" value={p.serviceSpeed ? p.serviceSpeed + " kn" : null} />
            <ReviewRow label="ME At Sea" value={p.meConsSea ? p.meConsSea + " MT/d " + (p.fuelType || "") : null} />
            <ReviewRow label="Bunkers ROB" value={p.brob ? p.brob + " MT" : null} />
            <ReviewRow label="Gear" value={g.geared == null ? null : g.geared ? (g.craneCount || "") + "× " + (g.craneSwl || "") + " MT" + (g.grabs ? " + grabs" : "") : "Gearless"} />
          </div>
        </div>
      </div>
    );
  }
  function revSummary() { return "Confirm and post"; }
  function revComplete(s) {
    const dwt = Number(s.vessel && s.vessel.dwt) || 0;
    if (s.entryMode === "tbn") return true;
    return dwt > 0 && dwt <= (PP2.SIZE_GATE_DWT || 66000);
  }

  window.PP2Steps = Object.assign(window.PP2Steps || {}, {
    vessel: { render: (ctx) => <VesselStep {...ctx} />, summary: vesselSummary, complete: vesselComplete },
    arrangement: { render: (ctx) => <ArrangementStep {...ctx} />, summary: arrSummary, complete: arrComplete },
    availability: { render: (ctx) => <AvailabilityStep {...ctx} />, summary: avSummary, complete: avComplete },
    performance: { render: (ctx) => <PerformanceStep {...ctx} />, summary: perfSummary, complete: perfComplete },
    gear: { render: (ctx) => <GearStep {...ctx} />, summary: gearSummary, complete: gearComplete },
    review: { render: (ctx) => <ReviewStep {...ctx} />, summary: revSummary, complete: revComplete },
  });
})();
