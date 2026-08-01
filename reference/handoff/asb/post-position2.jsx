// asb/post-position2.jsx, Post Position (rebuild): collapsing-step accordion.
// Rebuilt fresh from ArabShipBroker_UNIFIED_CargoMap_14Jul2026 spec.
// Architecture: minimum-viable capture up front; backend + Bosun AI enrich the rest.
// Steps (accordion): Vessel, Cargo arrangement, Availability, Performance, Gear, Review.
// Bosun AI is a floating corner agent (paste circular / upload Q88 -> mock extract -> apply).
// Composes ASB Design System components (window.ASBDesignSystem_0955c8) under a .asb-ds root.
(function () {
  const { useState, useRef, useEffect } = React;
  const DS = window.ASBDesignSystem_0955c8 || {};
  const { Button, Icon, StatusBadge } = DS;
  const PP2 = window.PP2 || {};
  const uid = () => Math.random().toString(36).slice(2);
  const nf = (n) => Number(n).toLocaleString("en-US");

  const CheckSVG = () => (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="5,12 10,17 19,7" /></svg>
  );
  const SendSVG = () => (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12 L20 5 L14 20 L11 13 Z" /></svg>
  );

  // ── Bosun mock extractors ────────────────────────────────────
  const SAMPLE_CIRCULAR = `MV ALTO SUMMER\nIMO 9145786 / blt 2006 / 24,804 DWT\nGeared 2 x 30t cranes\nOpen Odessa 18-22 Aug, worldwide redelivery\nOwners keen, offers WOG`;

  function parseCircular(text) {
    const t = String(text || ""); const lower = t.toLowerCase(); const ex = {};
    const imoM = t.match(/imo[^0-9]{0,4}(\d{7})/i) || t.match(/\b(\d{7})\b/);
    if (imoM) ex.imo = imoM[1];
    const nameM = t.match(/\bm[vt]\s+([A-Za-z][A-Za-z0-9 .'`]{2,32})/i);
    if (nameM) ex.name = nameM[1].trim().replace(/\s{2,}/g, " ").toUpperCase();
    const dwtM = t.match(/([\d][\d,\.]{2,})\s*(?:dwt|dwcc|mt\b)/i);
    if (dwtM) ex.dwt = parseInt(dwtM[1].replace(/[,\.]/g, ""), 10);
    const bM = t.match(/\b(?:blt|built)\.?\s*((?:19|20)\d{2})/i);
    if (bM) ex.built = bM[1];
    if (/\bgearless\b/i.test(t)) ex.geared = false;
    else if (/\bgeared\b|\bcranes?\b|\bgrabs?\b/i.test(t)) ex.geared = true;
    if (/\bwog\b|without guarantee/i.test(t)) ex.wog = true;
    let found = null;
    for (const p of (PP2.PORTS || [])) { if (p.name.length >= 4 && lower.includes(p.name.toLowerCase())) { found = p; break; } }
    if (found) ex.port = found;
    const mo = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    const dM = t.match(/\b(\d{1,2})\s*[-\/]\s*(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i);
    if (dM) {
      const m = mo[dM[3].toLowerCase().slice(0, 3)]; const now = new Date(); let yr = now.getFullYear();
      let from = new Date(yr, m, +dM[1]); if (from < now) { yr += 1; from = new Date(yr, m, +dM[1]); }
      const to = new Date(yr, m, +dM[2]);
      ex.openFrom = from.toISOString().slice(0, 10); ex.openTo = to.toISOString().slice(0, 10);
    }
    return ex;
  }
  function cannedQ88(fileName) {
    // Rich long-form Q88 extract (Baltic 99 style): identity, dimensions, class,
    // cargo arrangement, gear + grabs, performance and capacity.
    return {
      imo: "9401233", name: "GULF STAR", type: "General Cargo", dwt: 12680, built: "2011",
      flag: "Marshall Islands", grt: 9611, loa: 142.5, beam: 22.6, draft: 8.9, classSociety: "BV",
      arrangement: { numHolds: 3, numHatches: 3, boxShaped: "Y", hatchType: "folding", strengthenedHeavy: "Y", holdsMayBeEmpty: "Y", logFitted: "N" },
      gear: { geared: true, craneCount: 3, craneSwl: 30, grabs: true, numGrabs: 3, grabCapacity: 8 },
      performance: { serviceSpeed: 12.5, meConsSea: 18.5, meConsPort: 2, auxConsPort: 1.6, fuelType: "VLSFO", brob: 140 },
      capacity: { grainCbm: 16700, dwtBale: 16100, dwcc: 12100 },
      _file: fileName, _fields: 22,
    };
  }
  function exToPatch(ex, state) {
    const p = {}; const reg = ex.imo ? PP2.findVesselByIMO(ex.imo) : null;
    if (reg) { p.vessel = { ...reg }; p.vesselImo = reg.imo; p.entryMode = "fleet"; }
    else if (ex.imo || ex.name) { p.vessel = { imo: ex.imo || "", name: ex.name || "", type: ex.type || "Bulk Carrier", dwt: ex.dwt || "", built: ex.built || "", flag: ex.flag || "", grt: ex.grt || "", loa: ex.loa || "", beam: ex.beam || "", draft: ex.draft || "", classSociety: ex.classSociety || "", verified: false, source: ex._file ? "Bosun AI (Q88)" : "Bosun AI" }; p.vesselImo = ex.imo || null; p.entryMode = "imo"; }
    const av = { ...(state.availability || {}) }; av.status = av.status || "Open";
    if (ex.port) av.openPort = ex.port; if (ex.openFrom) av.openFrom = ex.openFrom; if (ex.openTo) av.openTo = ex.openTo; if (ex.wog) av.wog = true;
    p.availability = av;
    if (ex.arrangement) p.arrangement = { ...(state.arrangement || {}), ...ex.arrangement, _source: "user" };
    if (ex.performance) p.performance = { ...(state.performance || {}), ...ex.performance, _source: "user" };
    if (ex.gear) p.gear = { ...(state.gear || {}), ...ex.gear, _source: "user" };
    return p;
  }
  function exRows(ex) {
    const reg = ex.imo ? PP2.findVesselByIMO(ex.imo) : null; const rows = [];
    if (reg) rows.push(["Vessel", reg.name + " (on file)"]); else if (ex.name) rows.push(["Vessel", ex.name]);
    if (ex.imo) rows.push(["IMO", ex.imo]);
    const dwt = ex.dwt || (reg && reg.dwt); if (dwt) rows.push(["DWT", nf(dwt) + " MT"]);
    if (ex.type) rows.push(["Type", ex.type]);
    if (ex.built) rows.push(["Built", ex.built]);
    if (ex.flag) rows.push(["Flag", ex.flag]);
    if (ex.classSociety) rows.push(["Class", ex.classSociety]);
    if (ex.loa) rows.push(["LOA / beam", ex.loa + " m" + (ex.beam ? " / " + ex.beam + " m" : "")]);
    if (ex.grt) rows.push(["GRT", nf(ex.grt)]);
    if (ex.arrangement && ex.arrangement.numHolds) rows.push(["Holds", ex.arrangement.numHolds + "H / " + (ex.arrangement.numHatches || ex.arrangement.numHolds) + "Ha" + (ex.arrangement.hatchType ? ", " + ex.arrangement.hatchType : "")]);
    if (ex.gear) rows.push(["Gear", ex.gear.geared ? (ex.gear.craneCount + "x" + ex.gear.craneSwl + "t cranes" + (ex.gear.grabs ? ", " + ex.gear.numGrabs + "x" + ex.gear.grabCapacity + "t grabs" : "")) : "Gearless"]);
    else if (ex.geared != null) rows.push(["Gear", ex.geared ? "Geared" : "Gearless"]);
    if (ex.performance) { const pf = ex.performance; if (pf.serviceSpeed) rows.push(["Service speed", pf.serviceSpeed + " kn"]); if (pf.meConsSea) rows.push(["ME at sea", pf.meConsSea + " MT/d " + (pf.fuelType || "")]); if (pf.brob) rows.push(["Bunkers ROB", pf.brob + " MT"]); }
    if (ex.capacity && ex.capacity.grainCbm) rows.push(["Grain / bale", nf(ex.capacity.grainCbm) + " / " + nf(ex.capacity.dwtBale) + " cbm"]);
    if (ex.port) rows.push(["Open port", ex.port.name]);
    if (ex.openFrom) rows.push(["Laycan", ex.openFrom + (ex.openTo ? " to " + ex.openTo : "")]);
    if (ex.wog) rows.push(["Terms", "WOG"]);
    return rows;
  }

  // ── Bosun floating agent ─────────────────────────────────────
  function BosunAgent({ onApply }) {
    const [open, setOpen] = useState(false);
    const [input, setInput] = useState("");
    const [busy, setBusy] = useState(false);
    const [msgs, setMsgs] = useState(() => [
      { id: "greet", role: "bosun", kind: "text", text: "Ahoy, I'm Bosun. Paste a position circular below, or upload the vessel's Q88, and I'll read it and fill the form for you to check." },
      { id: "actions", role: "bosun", kind: "actions" },
    ]);
    const threadRef = useRef(null);
    const inputRef = useRef(null);
    const fileRef = useRef(null);
    useEffect(() => { const el = threadRef.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs, open]);
    useEffect(() => { const h = () => setOpen(true); window.addEventListener("pp2-bosun-open", h); return () => window.removeEventListener("pp2-bosun-open", h); }, []);

    const respond = (ex, userText) => {
      setBusy(true);
      setMsgs((m) => [...m, { id: uid(), role: "user", kind: "text", text: userText }, { id: "typing", role: "bosun", kind: "typing" }]);
      setTimeout(() => {
        const ok = ex && (ex.imo || ex.name || ex.port || ex.arrangement);
        setMsgs((m) => m.filter((x) => x.id !== "typing").concat(ok
          ? [{ id: uid(), role: "bosun", kind: "text", text: "Aye, here's what I read. Check it over and hit Apply and I'll fill the form." }, { id: uid(), role: "bosun", kind: "result", ex }]
          : [{ id: uid(), role: "bosun", kind: "text", text: "I couldn't find vessel or position details in that. Paste a fuller circular, or upload the Q88." }]));
        setBusy(false);
      }, 750);
    };
    const send = () => { const t = input.trim(); if (!t || busy) return; setInput(""); respond(parseCircular(t), t); };
    const onKey = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } };
    const applyEx = (ex) => { onApply(ex); setMsgs((m) => [...m, { id: uid(), role: "bosun", kind: "text", text: "Done. I've filled the form from what I read. Please review each step and confirm before you post." }]); };
    const pickFile = () => fileRef.current && fileRef.current.click();
    const onFile = (e) => { const f = e.target.files && e.target.files[0]; if (!f) return; e.target.value = ""; respond(cannedQ88(f.name), "Uploaded Q88: " + f.name); };

    if (!open) {
      return (
        <button className="pp2-fab" type="button" onClick={() => setOpen(true)} aria-label="Open Bosun AI assistant">
          <span className="pp2-fab__ava">{Icon ? <Icon name="Vessel" size={20} /> : "AI"}<span className="pp2-fab__dot" /></span>
          <span className="pp2-fab__label"><b>Ask Bosun</b><span>Smart Assistant</span></span>
        </button>
      );
    }
    return (
      <div className="pp2-agent" role="dialog" aria-label="Bosun AI assistant">
        <div className="pp2-agent__head">
          <span className="pp2-agent__ava">{Icon ? <Icon name="Vessel" size={20} /> : "AI"}<span className="pp2-fab__dot" /></span>
          <div className="pp2-agent__id">
            <div className="pp2-agent__name">Bosun AI</div>
            <div className="pp2-agent__role">Smart Assistant</div>
          </div>
          <button className="pp2-agent__x" type="button" onClick={() => setOpen(false)} aria-label="Close">{Icon ? <Icon name="Close" size={16} /> : "X"}</button>
        </div>
        <div className="pp2-agent__thread" ref={threadRef}>
          {msgs.map((m) => {
            if (m.kind === "actions") return (
              <div className="pp2-agent__chips" key={m.id}>
                <button className="pp2-agent__chip" type="button" onClick={() => inputRef.current && inputRef.current.focus()}>{Icon ? <Icon name="Doc" size={13} /> : null} Paste a circular</button>
                <button className="pp2-agent__chip" type="button" onClick={pickFile}>{Icon ? <Icon name="Plus" size={13} /> : null} Upload Q88</button>
                <button className="pp2-agent__chip pp2-agent__chip--link" type="button" onClick={() => { setInput(SAMPLE_CIRCULAR); inputRef.current && inputRef.current.focus(); }}>Try a sample</button>
              </div>
            );
            if (m.kind === "typing") return (
              <div className="pp2-msg pp2-msg--bosun" key={m.id}>
                <span className="pp2-msg__ava">{Icon ? <Icon name="Vessel" size={14} /> : null}</span>
                <span className="pp2-msg__bubble"><span className="pp2-agent__typing"><i /><i /><i /></span></span>
              </div>
            );
            if (m.kind === "result") return (
              <div className="pp2-msg pp2-msg--bosun" key={m.id}>
                <span className="pp2-msg__ava">{Icon ? <Icon name="Vessel" size={14} /> : null}</span>
                <div className="pp2-extract">
                  <div className="pp2-extract__h">{m.ex._file ? "Read from Q88" : "Read from circular"}</div>
                  <div className="pp2-extract__rows">
                    {exRows(m.ex).map((r, i) => <div className="pp2-extract__row" key={i}><span className="pp2-extract__k">{r[0]}</span><span className="pp2-extract__v">{r[1]}</span></div>)}
                  </div>
                  <div className="pp2-extract__apply"><Button variant="primary" onClick={() => applyEx(m.ex)}>Apply to form</Button></div>
                </div>
              </div>
            );
            return (
              <div className={"pp2-msg pp2-msg--" + m.role} key={m.id}>
                {m.role === "bosun" && <span className="pp2-msg__ava">{Icon ? <Icon name="Vessel" size={14} /> : null}</span>}
                <span className="pp2-msg__bubble">{m.text}</span>
              </div>
            );
          })}
        </div>
        <div className="pp2-agent__foot">
          <input ref={fileRef} type="file" accept=".pdf,.xls,.xlsx,.doc,.docx" style={{ display: "none" }} onChange={onFile} />
          <textarea ref={inputRef} className="pp2-agent__input" rows={1} placeholder="Paste a circular, or type a note..." value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKey} />
          <button className="pp2-agent__send" type="button" onClick={send} disabled={!input.trim() || busy} aria-label="Send"><SendSVG /></button>
        </div>
      </div>
    );
  }

  function Placeholder({ hint }) {
    return <div className="pp2-placeholder"><span className="pp2-placeholder__dot" />{hint}</div>;
  }

  function PostPosition2() {
    const [state, setState] = useState(() => ({ entryMode: null, vesselImo: null, vessel: null }));
    const patch = (u) => setState((s) => ({ ...s, ...u }));

    const steps = [
      { id: "vessel", title: "Vessel", hint: "IMO / fleet / TBN, identity, verification" },
      { id: "arrangement", title: "Cargo arrangement", hint: "Holds, hatches, box-shaped, heavy-strengthened, log-fitted" },
      { id: "availability", title: "Availability", hint: "Status, open port, dates, zone, WOG, charter type" },
      { id: "performance", title: "Performance", hint: "Fuel type, ME sea/port, AUX, BROB, service speed" },
      { id: "gear", title: "Gear", hint: "Cranes, SWL, grabs (if geared)" },
      { id: "review", title: "Review & submit", hint: "Summary, verification, post the position" },
    ];

    const [current, setCurrent] = useState(0);
    const stepDef = (id) => (window.PP2Steps || {})[id] || {};
    const isStepComplete = (s) => { const d = stepDef(s.id); return d.complete ? d.complete(state) : true; };
    // Free navigation: any step can be opened. Submit is gated on all mandatory being complete.
    const openStep = (i) => setCurrent((c) => (c === i ? -1 : i));
    const advance = (i) => setCurrent(i + 1 < steps.length ? i + 1 : -1);
    const goBack = (i) => setCurrent(i - 1 >= 0 ? i - 1 : 0);
    const allComplete = steps.every(isStepComplete);

    // Bosun apply: merge extracted fields, jump to first remaining gap.
    const applyExtract = (ex) => {
      const next = { ...state, ...exToPatch(ex, state) };
      setState(next);
      const fi = steps.findIndex((st) => { const d = stepDef(st.id); return d.complete ? !d.complete(next) : false; });
      setCurrent(fi === -1 ? steps.length - 1 : fi);
    };

    const completedCount = steps.filter(isStepComplete).length;
    const pct = Math.round((completedCount / steps.length) * 100);

    return (
      <div className="pp2">
        <header className="pp2-head">
          <div className="pp2-head__top">
            <span className="pp2-head__icon">{Icon ? <Icon name="Vessel" size={34} /> : null}</span>
            <div className="pp2-head__text">
              <div className="pp2-eyebrow">Post Position</div>
              <h1 className="pp2-title">List a vessel's open position</h1>
            </div>
          </div>
          <p className="pp2-sub">Give us the essentials: the vessel and where she's open. We collect the minimum a charterer needs to match and estimate, then the platform and Bosun AI fill in the technical detail from the vessel's Q88.</p>
          <div className="pp2-progress">
            <span className="pp2-progress__label">{completedCount} of {steps.length} complete</span>
            <div className="pp2-progress__bar"><div className="pp2-progress__fill" style={{ width: pct + "%" }} /></div>
          </div>
        </header>

        <div className="pp2-steps">
          {steps.map((s, i) => {
            const active = current === i, isDone = isStepComplete(s);
            const def = (window.PP2Steps || {})[s.id] || {};
            const cls = ["pp2-step", active && "is-active", isDone && "is-done"].filter(Boolean).join(" ");
            return (
              <section className={cls} key={s.id}>
                <button className="pp2-step__head" type="button" onClick={() => openStep(i)} aria-expanded={active}>
                  <span className="pp2-step__num">{isDone && !active ? <CheckSVG /> : i + 1}</span>
                  <span className="pp2-step__titles">
                    <span className="pp2-step__title">{s.title}</span>
                    {!active && <span className={"pp2-step__summary" + (isDone ? "" : " is-hint")}>{isDone && def.summary ? def.summary(state) : s.hint}</span>}
                  </span>
                  <span className="pp2-step__chev">{Icon ? <Icon name="Caret" size={16} /> : "v"}</span>
                </button>
                <div className="pp2-step__bodywrap"><div className="pp2-step__bodyinner"><div className="pp2-step__body">
                  {def.render ? def.render({ state, patch }) : <Placeholder hint={s.hint} />}
                  <div className="pp2-step__foot">
                    {i > 0 ? <Button variant="ghost" onClick={() => goBack(i)}>Back</Button> : <span />}
                    {i === steps.length - 1 && !allComplete ? <span className="pp2-foot-hint">Complete all required steps to submit</span> : null}
                    <Button variant="primary" onClick={() => advance(i)} disabled={i === steps.length - 1 ? !allComplete : false}>{i === steps.length - 1 ? "Submit position" : "Continue"}</Button>
                  </div>
                </div></div></div>
              </section>
            );
          })}
        </div>

        <BosunAgent onApply={applyExtract} />
      </div>
    );
  }

  window.PagePostPosition2 = PostPosition2;
  window.PP2Bosun = BosunAgent;
  window.PP2exToPatch = exToPatch;
  window.PP2parse = parseCircular;
  window.PP2exRows = exRows;
  window.PP2sample = SAMPLE_CIRCULAR;
  const mount = document.getElementById("pp2-root");
  if (mount) ReactDOM.createRoot(mount).render(<PostPosition2 />);
})();
