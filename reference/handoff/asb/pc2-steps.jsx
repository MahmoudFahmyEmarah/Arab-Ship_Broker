// asb/pc2-steps.jsx, Post Cargo (rebuild) step bodies + shared field helpers.
// Registered on window.PC2Steps; the shell (post-cargo2.jsx) looks each step up by id.
// Frontend captures name + dry/break-bulk + commercial terms only; backend classifies.
(function () {
  const { useState, useMemo, useEffect } = React;
  const DS = window.ASBDesignSystem_0955c8 || {};
  const { Button, Input, Icon, SegmentedToggle } = DS;
  const PP2 = window.PP2 || {};
  const PC2 = window.PC2 || {};
  const CAP = PC2.LAYCAN_CAP_DAYS || 45;
  const fmt = (n) => (n == null || n === "" ? "-" : Number(n).toLocaleString("en-US"));

  function Field({ label, req, help, full, children }) {
    return (
      <div className={"pp2-field" + (full ? " pp2-field--full" : "")}>
        <label className="pp2-label">{label}{req && <span className="pp2-label__req">*</span>}{help && <span className="pp2-tip" tabIndex={0}><span className="pp2-tip__mark">!</span><span className="pp2-tip__bub">{help}</span></span>}</label>
        {children}
      </div>
    );
  }
  function Select({ value, onChange, options, placeholder }) {
    return (
      <select className="pp2-select" value={value || ""} onChange={(e) => onChange(e.target.value)}>
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => { const v = typeof o === "string" ? o : o.value; const l = typeof o === "string" ? o : o.label; return <option key={v} value={v}>{l}</option>; })}
      </select>
    );
  }
  const DAY_DEFS = {
    "WWD FHEX": "Weather working days, Fridays and holidays excepted. Common across the Gulf and Red Sea.",
    "WWD SHINC": "Weather working days, Sundays and holidays included.",
    "WWD SHEX": "Weather working days, Sundays and holidays excepted.",
    "FHEX": "Fridays and holidays excepted.",
    "SHINC": "Sundays and holidays included. Every calendar day counts.",
    "SHEX EIU": "Sundays and holidays excepted, even if used.",
    "CQD": "Customary quick despatch. No fixed laytime; cargo is worked as fast as the port customarily allows.",
  };
  const RATE_DEFS = {
    "Per day (MT/day)": "Fixed tonnes per day. Laytime = quantity divided by the rate.",
    "Per hatch / day": "Rate multiplied by the number of hatches (BIMCO Laytime Definition 6).",
    "Per working hatch / day": "Largest hold divided by (rate times the hatches serving it), per BIMCO Definition 7.",
    "CQD": "Customary quick despatch. No fixed rate; worked as fast as the port allows.",
    "Total days": "A fixed total number of laytime days for the whole call.",
  };
  const CARGOFORM_DEFS = {
    "Bulk": "Loaded loose into the hold, unpackaged.",
    "Bagged (50 kg)": "In standard 50 kg sacks, sling- or belt-loaded.",
    "Big bags (1-1.5 t)": "Flexible bulk bags (FIBC) of about 1 to 1.5 tonnes each.",
    "Break-bulk": "Individually handled pieces: crates, drums, bundles, coils, units.",
    "Palletised": "Stacked and strapped on pallets for fork-lift handling.",
  };
  const OPTHOLDER_DEFS = {
    "MOLOO": "More Or Less Owner's Option. The owner sets the final loaded quantity within the tolerance.",
    "MOLCHOPT": "More Or Less Charterer's Option. The charterer sets the final quantity within the tolerance.",
  };
  const NOR_DEFS = {
    "WIPON WIBON WIFPON WICCON": "Notice may be tendered Whether In Port Or Not, Whether In Berth Or Not, Whether In Free Pratique Or Not, Whether In Customs Clearance Or Not.",
    "On arrival / ATDN": "NOR valid once the ship arrives, tendered Any Time Day or Night.",
    "Turn time 12h once NOR tendered": "A fixed 12-hour allowance after NOR is tendered before laytime starts to count.",
  };
  const FBASIS_DEFS = {
    "Per MT": "Freight priced per metric tonne of cargo loaded.",
    "Lumpsum": "One fixed freight for the whole cargo, whatever the final quantity.",
  };
  const DESPATCH_DEFS = {
    "Half demurrage": "Despatch paid at half the demurrage rate for laytime saved. The market norm.",
    "No despatch": "No money paid to the charterer for finishing early.",
    "Free of despatch": "Laytime is free of despatch; the owner owes nothing for time saved.",
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
  function NumInput({ value, onChange, placeholder, unit, decimal, max }) {
    return (
      <div className="pp2-num">
        <input className="pp2-select" style={{ backgroundImage: "none" }} inputMode={decimal ? "decimal" : "numeric"} value={value == null ? "" : value}
          onChange={(e) => { let v = e.target.value.replace(decimal ? /[^\d.]/g : /[^\d]/g, ""); if (max != null && Number(v) > max) v = String(max); onChange(v); }} placeholder={placeholder} />
        {unit && <span className="pp2-num__unit">{unit}</span>}
      </div>
    );
  }
  function PortPicker({ value, onChange, placeholder }) {
    const [q, setQ] = useState(""); const [open, setOpen] = useState(false);
    const results = useMemo(() => PP2.findPorts ? PP2.findPorts(q, 8) : [], [q]);
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
                <span className="pp2-port__opt-name">{p.name}</span><span className="pp2-port__opt-meta">{p.locode} · {p.zoneName || p.zone}{p.country ? " · " + p.country : ""}</span>
              </button>
            ))}
            {results.length === 0 && <div className="pp2-port__empty">No port matches “{q}”.</div>}
          </div>
        )}
      </div>
    );
  }

  // ── Tier (standalone pages have no Portal TierContext; use a shared demo store) ─
  const TierStore = window.__ASBTierStore || (window.__ASBTierStore = { tier: window.__ASB_TIER__ || "T4", subs: new Set(), set(t){ this.tier = t; window.__ASB_TIER__ = t; this.subs.forEach((f) => f(t)); } });
  function useViewerTier(){ const [t, setT] = useState(TierStore.tier); useEffect(() => { const f = (x) => setT(x); TierStore.subs.add(f); return () => TierStore.subs.delete(f); }, []); return t; }
  function DemoTierSwitch(){
    const t = useViewerTier();
    const tiers = [["T1", "Free"], ["T2", "Registered"], ["T3", "Subscriber"], ["T4", "Broker"]];
    return (
      <div className="pp2-demotier">
        <span className="pp2-demotier__lbl">Demo tier</span>
        <div className="pp2-demotier__seg">
          {tiers.map(([id, label]) => <button key={id} type="button" className={"pp2-demotier__b" + (t === id ? " is-on" : "")} onClick={() => TierStore.set(id)}>{id}<em>{label}</em></button>)}
        </div>
      </div>
    );
  }
  window.DemoTierSwitch = DemoTierSwitch;

  // ── Smart cargo classification readout (reads the ASB cargo DB) ─
  function ClsRow({ label, value, tone }){ return (<div className="pp2-cls__row"><span className="pp2-cls__k">{label}</span><span className={"pp2-cls__v pp2-cls__v--" + (tone || "neutral")}>{value}</span></div>); }
  function Classification({ item }){
    const c = PC2.classify ? PC2.classify(item) : null;
    if (!c) return null;
    return (
      <div className="pp2-cls">
        <div className="pp2-cls__hd">
          <div className="pp2-cls__name">{item.name}</div>
          <div className="pp2-cls__regime">{c.regimeLabel}{c.group ? " · Group " + c.group : ""}</div>
        </div>
        <div className="pp2-cls__rows">
          <ClsRow label="Cargo form" tone="info" value={c.isBreak ? "Break-bulk" : "Dry bulk"} />
          <ClsRow label="Classification" tone="info" value={c.category} />
          <ClsRow label="UN number" tone={c.un ? "amber" : "ok"} value={c.un ? "UN " + c.un : "None assigned"} />
          <ClsRow label="Dangerous goods (DG)" tone={c.isDG ? "danger" : "ok"} value={c.isDG ? "Yes, UN-listed" : "No"} />
          <ClsRow label="MHB" tone={c.isMHB ? "amber" : "ok"} value={c.isMHB ? "Yes, hazardous in bulk" : "No"} />
        </div>
        {c.liquefy ? <div className="pp2-cls__flag"><span>Group A, may liquefy. Moisture content / TML certificate required at load.</span></div> : null}
        <div className="pp2-cls__src"><span>Read live from the ASB cargo database. Final group, stowage factor and safety controls are confirmed on posting.</span></div>
      </div>
    );
  }

  // ── Commodity step ───────────────────────────────────────────
  function CommodityStep({ state, patch }) {
    const tier = useViewerTier();
    const smart = tier === "T3" || tier === "T4";
    const [q, setQ] = useState("");
    const [focus, setFocus] = useState(null);
    const cur = state.commodity;
    const results = useMemo(() => PC2.findCommodities ? PC2.findCommodities(q, smart ? 40 : 10) : [], [q, smart]);
    const choose = (c) => { patch({ commodity: { name: c.name, form: c.form, source: c.source, group: c.group, regime: c.regime, multi: c.multi } }); setFocus(c); };
    const patchC = (u) => patch({ commodity: { ...cur, ...u } });
    const srcMeta = (c) => { if (c.source === "imsbc") return "IMSBC · Group " + (c.group || "C") + " · dry bulk"; if (c.source === "grain") return "Grain Code · dry bulk"; if (c.source === "css") return (c.group ? c.group + " · " : "") + "CSS break-bulk"; return c.form === "break-bulk" ? "break-bulk" : "dry bulk"; };
    const fieldsBlock = cur ? (
      <div className="pp2-grid" style={{ marginTop: 15 }}>
        <Field label="Cargo type" req help="A coarse pick that helps the platform classify. Dry bulk loads loose in the hold; break-bulk is bagged, palletised or unitised.">
          {SegmentedToggle ? <SegmentedToggle className="pp2-yn" value={cur.form} onChange={(x) => patchC({ form: x })} options={[{ value: "dry-bulk", label: "Dry bulk" }, { value: "break-bulk", label: "Break-bulk" }]} /> : null}
        </Field>
        <Field label="Packaging / form" help="Optional. How it presents on board.">
          <SelectTip value={cur.packaging} onChange={(x) => patchC({ packaging: x })} options={PC2.ENUMS.cargoForm} defs={CARGOFORM_DEFS} placeholder="Select…" />
        </Field>
      </div>
    ) : null;
    const multiNote = cur && cur.multi ? <div className="pp2-inline-note pp2-inline-note--alert"><span className="pp2-inline-note__t">This looks like a multi-parcel entry. Post each parcel as a separate cargo so the platform can classify each one.</span></div> : null;

    // ── T3 / T4: split smart search + live classification ──
    if (smart) {
      const preview = focus || cur || results[0] || null;
      return (
        <div className="pp2-cmdx-wrap">
          <div className="pp2-cmdx">
            <div className="pp2-cmdx__left">
              <div className="pp2-cmdx__search">{Icon ? <Icon name="Search" size={16} /> : null}<input value={q} placeholder="Search commodity, e.g. Wheat, DAP, Steel Coils…" onChange={(e) => setQ(e.target.value)} />{q ? <button type="button" className="pp2-cmdx__clear" onClick={() => setQ("")}>Clear</button> : null}</div>
              <div className="pp2-cmdx__list">
                {results.map((c) => (
                  <button type="button" key={c.name + c.source} className={"pp2-cmdx__opt" + (cur && cur.name === c.name ? " is-sel" : "") + (preview && preview.name === c.name && preview.source === c.source ? " is-focus" : "")} onMouseEnter={() => setFocus(c)} onFocus={() => setFocus(c)} onClick={() => choose(c)}>
                    <span className="pp2-cmdx__opt-name">{c.name}</span>
                    <span className="pp2-cmdx__opt-meta">{srcMeta(c)}</span>
                  </button>
                ))}
                {q.trim() && results.length === 0 ? <div className="pp2-port__empty">No commodity matches “{q}”. Type the trade name and pick the nearest, or let Foreman read a circular.</div> : null}
                {!q.trim() ? <div className="pp2-cmdx__hint"><span>Start typing to search the ASB classified-cargo database.</span></div> : null}
              </div>
            </div>
            <div className="pp2-cmdx__right">
              {preview ? <Classification item={preview} /> : <div className="pp2-cmdx__empty">{Icon ? <Icon name="Cargo" size={26} /> : null}<span>Search and hover a commodity to see its live IMSBC / Grain Code classification.</span></div>}
            </div>
          </div>
          {cur ? <div className="pp2-cmdx__sel"><span className="pp2-cmdx__seldot" /><span><strong>{cur.name}</strong> selected · {cur.form === "break-bulk" ? "Break-bulk" : "Dry bulk"}</span><button type="button" className="pp2-vcard__change" onClick={() => { patch({ commodity: null }); setFocus(null); }}>Change</button></div> : null}
          {multiNote}
          {fieldsBlock}
        </div>
      );
    }

    // ── T1 / T2: simple search (smart preview locked) ──
    if (!cur) {
      return (
        <div className="pp2-fleet">
          <input className="pp2-select" style={{ backgroundImage: "none" }} value={q} placeholder="Search commodity, e.g. Wheat, Sugar, Steel Coils…" onChange={(e) => setQ(e.target.value)} />
          {q.trim() ? (
            <div className="pp2-port__menu" style={{ position: "static", boxShadow: "none", marginTop: 2 }}>
              {results.map((c) => (
                <button type="button" className="pp2-port__opt" key={c.name + c.source} onClick={() => choose(c)}>
                  <span className="pp2-port__opt-name">{c.name}</span>
                  <span className="pp2-port__opt-meta">{srcMeta(c)}{c.multi ? " · multi-parcel" : ""}</span>
                </button>
              ))}
              {results.length === 0 && <div className="pp2-port__empty">No commodity matches “{q}”. Type the trade name and pick the nearest, or let Foreman read a circular.</div>}
            </div>
          ) : (
            <div className="pp2-fleet__hint"><span>Start typing the commodity trade name to find it.</span></div>
          )}
          <div className="pp2-cmdx__locked"><span>Live cargo classification (dry/break, Grain vs IMSBC, UN number, DG, MHB) is available from <strong>Subscriber tier (T3+)</strong>.</span></div>
        </div>
      );
    }
    return (
      <div className="pp2-commodity">
        <div className="pp2-vcard" style={{ marginBottom: 15 }}>
          <div className="pp2-vcard__top">
            <div><div className="pp2-vcard__name">{cur.name}</div><div className="pp2-vcard__imo">{srcMeta(cur)} · resolved by the platform</div></div>
            <button type="button" className="pp2-vcard__change" onClick={() => patch({ commodity: null })}>Change</button>
          </div>
        </div>
        {fieldsBlock}
        {multiNote}
        <div className="pp2-inline-note"><span className="pp2-inline-note__t">IMSBC group, stowage factor and safety controls are resolved by the platform once you post.</span></div>
      </div>
    );
  }
  function commoditySummary(s) { const c = s.commodity; if (!c) return "Not set"; return c.name + " · " + (c.form === "break-bulk" ? "break-bulk" : "dry bulk"); }
  function commodityComplete(s) { return !!(s.commodity && s.commodity.name && s.commodity.form); }

  // ── Quantity step ────────────────────────────────────────────
  function QuantityStep({ state, patch }) {
    const cur = state.quantity || { unit: "CbM", optionHolder: "MOLOO" };
    const patchQ = (u) => patch({ quantity: { ...cur, ...u } });
    return (
      <div className="pp2-qty">
        <div className="pp2-grid">
          <Field label="Quantity" req help="The cargo weight. Matched against vessel DWT for Strong / Good / Possible / Weak."><NumInput value={cur.qtyMt} onChange={(x) => patchQ({ qtyMt: x })} unit="MT" placeholder="e.g. 12,500" /></Field>
          <Field label="Tolerance" help="Margin on quantity, at the option-holder's choice."><div className="pp2-split"><NumInput value={cur.molooPct} onChange={(x) => patchQ({ molooPct: x })} unit="%" placeholder="e.g. 10" max={25} /><SelectTip value={cur.optionHolder} onChange={(x) => patchQ({ optionHolder: x })} options={PC2.ENUMS.optionHolder} defs={OPTHOLDER_DEFS} placeholder="Select…" /></div></Field>
          <Field label="Volume" req help="Cargo cubic. Required so the platform can stow-check against the vessel's grain / bale capacity."><NumInput value={cur.volume} onChange={(x) => patchQ({ volume: x })} unit={cur.unit} decimal placeholder="e.g. 16,500" /></Field>
          <Field label="Volume unit" req><SegmentedToggle className="pp2-yn" value={cur.unit} onChange={(x) => patchQ({ unit: x })} options={[{ value: "CbM", label: "CbM" }, { value: "CbFT", label: "CbFT" }]} /></Field>
        </div>
      </div>
    );
  }
  function qtySummary(s) { const q = s.quantity || {}; if (!q.qtyMt) return "Not set"; return fmt(q.qtyMt) + " MT" + (q.molooPct ? " +/- " + q.molooPct + "%" : "") + (q.volume ? " · " + fmt(q.volume) + " " + (q.unit || "CbM") : ""); }
  function qtyComplete(s) { const q = s.quantity; return !!(q && q.qtyMt && Number(q.qtyMt) > 0 && q.volume && Number(q.volume) > 0 && q.unit); }

  // ── Ports step ───────────────────────────────────────────────
  function PortsStep({ state, patch }) {
    const cur = state.ports || {};
    const patchP = (u) => patch({ ports: { ...cur, ...u } });
    return (
      <div className="pp2-ports">
        <div className="pp2-grid">
          <Field label="Load port (POL)" req help="Where the cargo loads. Resolves to a UN/LOCODE."><PortPicker value={cur.pol} onChange={(p) => patchP({ pol: p })} placeholder="Search load port…" /></Field>
          <Field label="Discharge port (POD)" req help="Where it discharges."><PortPicker value={cur.pod} onChange={(p) => patchP({ pod: p })} placeholder="Search discharge port…" /></Field>
          <Field label="Load rate" help="Guaranteed load rate for laytime."><NumInput value={cur.loadRate} onChange={(x) => patchP({ loadRate: x })} unit="MT/day" placeholder="e.g. 4,000" /></Field>
          <Field label="Discharge rate" help="Guaranteed discharge rate."><NumInput value={cur.dischRate} onChange={(x) => patchP({ dischRate: x })} unit="MT/day" placeholder="e.g. 3,000" /></Field>
          <Field label="Rate mechanism" help="How the load / discharge rate is expressed. Hover an option for its definition."><SelectTip value={cur.rateMechanism} onChange={(x) => patchP({ rateMechanism: x })} options={PC2.ENUMS.rateMechanism} defs={RATE_DEFS} placeholder="Select…" /></Field>
          <Field label="Day type & exceptions" help="Which days count toward laytime. Hover an option for its definition."><SelectTip value={cur.dayExceptions} onChange={(x) => patchP({ dayExceptions: x })} options={PC2.ENUMS.dayExceptions} defs={DAY_DEFS} placeholder="Select…" /></Field>
          <Field label="Turn time" help="Free period after NOR is tendered before laytime starts to count (BIMCO Laytime Definitions). Often a fixed allowance in the Gulf / Red Sea, e.g. 12 hours."><NumInput value={cur.turnTime} onChange={(x) => patchP({ turnTime: x })} unit="hrs" placeholder="e.g. 12" /></Field>
        </div>
        {cur.loadRate && cur.dischRate && (
          <div style={{ marginTop: 15 }}>
            <Field full label="Laytime, load vs discharge" help="Reversible = load and discharge laytime added together, one running total (BIMCO def 24). Average = time saved at one end offsets excess at the other (def 23). Separate = each end counted on its own.">
              {SegmentedToggle ? <SegmentedToggle className="pp2-yn" value={cur.reversible || "Non-reversible"} onChange={(x) => patchP({ reversible: x })} options={[{ value: "Non-reversible", label: "Separate" }, { value: "Reversible", label: "Reversible" }, { value: "Average", label: "Average" }]} /> : null}
            </Field>
          </div>
        )}
      </div>
    );
  }
  function portsSummary(s) { const p = s.ports || {}; if (!p.pol && !p.pod) return "Not set"; return (p.pol ? p.pol.name : "?") + " → " + (p.pod ? p.pod.name : "?"); }
  function portsComplete(s) { const p = s.ports; return !!(p && p.pol && p.pol.locode && p.pod && p.pod.locode); }

  // ── Laycan & terms step ──────────────────────────────────────
  const TODAY = new Date().toISOString().slice(0, 10);
  const addDays = (d, n) => { const dt = new Date(d + "T00:00:00"); dt.setDate(dt.getDate() + n); return dt.toISOString().slice(0, 10); };
  const diffDays = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
  function TermsStep({ state, patch }) {
    const cur = state.terms || { freightBasis: "Per MT", spot: false };
    const patchT = (u) => patch({ terms: { ...cur, ...u } });
    const capExceeded = cur.laycanFrom && cur.laycanTo && diffDays(cur.laycanFrom, cur.laycanTo) > CAP;
    const toBeforeFrom = cur.laycanFrom && cur.laycanTo && new Date(cur.laycanTo) < new Date(cur.laycanFrom);
    const maxTo = cur.laycanFrom ? addDays(cur.laycanFrom, CAP) : undefined;
    return (
      <div className="pp2-terms">
        <div className="pp2-grid">
          <Field label="Laycan from" req help="Earliest the vessel can present."><input type="date" className="pp2-select" style={{ backgroundImage: "none" }} min={TODAY} value={cur.laycanFrom || ""} onChange={(e) => patchT({ laycanFrom: e.target.value })} /></Field>
          <Field label={"Laycan to"} help={"Latest, within " + CAP + " days of laycan-from."}><input type="date" className="pp2-select" style={{ backgroundImage: "none" }} min={cur.laycanFrom || TODAY} max={maxTo} value={cur.laycanTo || ""} onChange={(e) => patchT({ laycanTo: e.target.value })} /></Field>
        </div>
        {toBeforeFrom && <div className="pp2-inline-note pp2-inline-note--alert"><span className="pp2-inline-note__t">Laycan-to is before laycan-from.</span></div>}
        {capExceeded && <div className="pp2-inline-note pp2-inline-note--alert"><span className="pp2-inline-note__t">Laycan spread exceeds the {CAP}-day cap - tighten the dates.</span></div>}
        <Field full label="NOR clause" help="When notice of readiness can be tendered."><SelectTip value={cur.norClause} onChange={(x) => patchT({ norClause: x })} options={PC2.ENUMS.norClause} defs={NOR_DEFS} placeholder="Select…" /></Field>
        <div className="pp2-grid" style={{ marginTop: 15 }}>
          <Field label="Freight idea" help="Indication only, guides offers."><div className="pp2-split"><span className="pp2-prefix">USD</span><NumInput value={cur.freight} onChange={(x) => patchT({ freight: x })} unit={cur.freightBasis === "Lumpsum" ? "LS" : "/MT"} decimal placeholder="e.g. 45" /></div></Field>
          <Field label="Freight basis"><SelectTip value={cur.freightBasis} onChange={(x) => patchT({ freightBasis: x })} options={PC2.ENUMS.freightBasis} defs={FBASIS_DEFS} placeholder="Select…" /></Field>
          <Field label="Despatch" help="Reward for finishing early."><SelectTip value={cur.despatch} onChange={(x) => patchT({ despatch: x })} options={PC2.ENUMS.despatch} defs={DESPATCH_DEFS} placeholder="Select…" /></Field>
          <Field label="Total commission" help="Address + brokerage, all-in."><NumInput value={cur.commissionPct} onChange={(x) => patchT({ commissionPct: x })} unit="%" decimal placeholder="e.g. 3.75" max={15} /></Field>
        </div>
        <div className="pp2-toggles">
          <label className="pp2-wog">{DS.Toggle ? <DS.Toggle checked={!!cur.spot} onChange={(e) => patchT({ spot: e.target.checked })} /> : null}<span className="pp2-wog__label">Spot / prompt cargo</span></label>
          <label className="pp2-wog">{DS.Toggle ? <DS.Toggle checked={!!cur.iac} onChange={(e) => patchT({ iac: e.target.checked })} /> : null}<span className="pp2-wog__label">Freight incl. address commission (IAC)</span></label>
        </div>
      </div>
    );
  }
  function termsSummary(s) { const t = s.terms || {}; if (!t.laycanFrom) return "Not set"; return "Laycan " + t.laycanFrom + (t.laycanTo ? " to " + t.laycanTo : "") + (t.freight ? " · USD " + t.freight : ""); }
  function termsComplete(s) { const t = s.terms; if (!t || !t.laycanFrom) return false; if (t.laycanTo && (new Date(t.laycanTo) < new Date(t.laycanFrom) || diffDays(t.laycanFrom, t.laycanTo) > CAP)) return false; return true; }

  // ── Review step ──────────────────────────────────────────────
  function RRow({ label, value }) { return <div className="pp2-rev__row"><span className="pp2-rev__k">{label}</span><span className="pp2-rev__v">{value || "-"}</span></div>; }
  function ReviewStep({ state }) {
    const c = state.commodity || {}, q = state.quantity || {}, p = state.ports || {}, t = state.terms || {};
    return (
      <div className="pp2-rev">
        <div className="pp2-rev__card">
          <div className="pp2-rev__head">{c.name || "Cargo"}</div>
          <div className="pp2-rev__grid">
            <RRow label="Cargo type" value={c.form === "break-bulk" ? "Break-bulk" : c.form ? "Dry bulk" : null} />
            <RRow label="Packaging" value={c.packaging} />
            <RRow label="Quantity" value={q.qtyMt ? fmt(q.qtyMt) + " MT" + (q.molooPct ? " +/- " + q.molooPct + "% " + (q.optionHolder || "") : "") : null} />
            <RRow label="Volume" value={q.volume ? fmt(q.volume) + " " + (q.unit || "CbM") : null} />
          </div>
        </div>
        <div className="pp2-rev__card">
          <div className="pp2-rev__sub">Lane &amp; terms</div>
          <div className="pp2-rev__grid">
            <RRow label="Load" value={p.pol ? p.pol.name + " (" + p.pol.locode + ")" : null} />
            <RRow label="Discharge" value={p.pod ? p.pod.name + " (" + p.pod.locode + ")" : null} />
            <RRow label="Laytime" value={p.reversible && p.loadRate && p.dischRate ? p.reversible : null} />
            <RRow label="Turn time" value={p.turnTime ? p.turnTime + " hrs" : null} />
            <RRow label="Laycan" value={t.laycanFrom ? t.laycanFrom + (t.laycanTo ? " to " + t.laycanTo : "") : null} />
            <RRow label="Freight idea" value={t.freight ? "USD " + t.freight + (t.freightBasis === "Lumpsum" ? " LS" : "/MT") : null} />
            <RRow label="Commission" value={t.commissionPct ? t.commissionPct + "%" + (t.iac ? " (IAC)" : "") : null} />
            <RRow label="NOR" value={t.norClause} />
          </div>
        </div>
        <div className="pp2-inline-note"><span className="pp2-inline-note__t">On posting, the platform resolves the IMSBC group, CSS regime, stowage factor and any safety controls from the commodity name.</span></div>
      </div>
    );
  }
  function revComplete(s) { return commodityComplete(s) && qtyComplete(s) && portsComplete(s) && termsComplete(s); }

  window.PC2Steps = {
    commodity: { render: (ctx) => <CommodityStep {...ctx} />, summary: commoditySummary, complete: commodityComplete },
    quantity: { render: (ctx) => <QuantityStep {...ctx} />, summary: qtySummary, complete: qtyComplete },
    ports: { render: (ctx) => <PortsStep {...ctx} />, summary: portsSummary, complete: portsComplete },
    terms: { render: (ctx) => <TermsStep {...ctx} />, summary: termsSummary, complete: termsComplete },
    review: { render: (ctx) => <ReviewStep {...ctx} />, summary: () => "Confirm and post", complete: revComplete },
  };
})();
