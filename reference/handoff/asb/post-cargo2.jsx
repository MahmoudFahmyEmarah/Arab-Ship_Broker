// asb/post-cargo2.jsx, Post Cargo (rebuild): collapsing-step accordion.
// Rebuilt fresh from ArabShipBroker_UNIFIED_CargoMap_14Jul2026 spec.
// Architecture: frontend collects the commodity NAME + a coarse dry-bulk / break-bulk pick
// plus commercial terms; the backend + QC platform classify (IMSBC group, CSS regime, SF, hazard).
// Steps (accordion): Commodity, Quantity, Ports, Laycan & terms, Review.
// Bosun AI is a floating corner agent (paste a cargo circular -> mock extract -> apply).
// Reuses the .pp2 shell styles and window.PP2 ports. Composes ASB Design System components.
(function () {
  const { useState, useRef, useEffect } = React;
  const DS = window.ASBDesignSystem_0955c8 || {};
  const { Button, Icon } = DS;
  const PP2 = window.PP2 || {};
  const PC2 = window.PC2 || {};
  const uid = () => Math.random().toString(36).slice(2);
  const nf = (n) => (n == null || n === "" ? "" : Number(n).toLocaleString("en-US"));

  const CheckSVG = () => (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="5,12 10,17 19,7" /></svg>
  );
  const SendSVG = () => (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12 L20 5 L14 20 L11 13 Z" /></svg>
  );

  const SAMPLE_CIRCULAR = `12,500 MT +/- 10% BAGGED SUGAR\nLOAD 1SB SANTOS / DISCH 1SB LAGOS\nLAYCAN 10-20 SEP\nFRT IDEA USD 45/MT FIOST, 3.75% TTL COMM`;

  function parseCircular(text) {
    const t = String(text || ""); const lower = t.toLowerCase(); const ex = {};
    // commodity: longest market-name match
    let best = null;
    for (const c of (PC2.COMMODITIES || [])) { const n = c.name.toLowerCase(); if (n.length >= 3 && lower.includes(n) && (!best || n.length > best.name.length)) best = c; }
    if (best) { ex.commodity = best.name; ex.form = /\bbag/i.test(t) ? "break-bulk" : best.form; }
    if (/\bbag/i.test(t)) ex.packaging = "Bagged (50 kg)";
    // quantity MT + tolerance
    const qM = t.match(/([\d][\d,\.]{1,})\s*(?:mt|mts|tons?|t\b)/i); if (qM) ex.qtyMt = parseInt(qM[1].replace(/[,\.]/g, ""), 10);
    const tolM = t.match(/(?:\+\/?-|moloo|moloc)\s*(\d{1,2})\s*%/i) || t.match(/(\d{1,2})\s*%\s*(?:moloo|option)/i); if (tolM) ex.molooPct = tolM[1];
    // ports: first two known ports; load / disch aware
    const found = [];
    for (const p of (PP2.PORTS || [])) { if (p.name.length >= 4) { const idx = lower.indexOf(p.name.toLowerCase()); if (idx >= 0) found.push({ p, idx }); } }
    found.sort((a, b) => a.idx - b.idx);
    if (found[0]) ex.pol = found[0].p; if (found[1]) ex.pod = found[1].p;
    // laycan dd-dd MON
    const mo = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    const dM = t.match(/\b(\d{1,2})\s*[-\/]\s*(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i);
    if (dM) { const m = mo[dM[3].toLowerCase().slice(0, 3)]; const now = new Date(); let yr = now.getFullYear(); let from = new Date(yr, m, +dM[1]); if (from < now) { yr += 1; from = new Date(yr, m, +dM[1]); } const to = new Date(yr, m, +dM[2]); ex.laycanFrom = from.toISOString().slice(0, 10); ex.laycanTo = to.toISOString().slice(0, 10); }
    // freight + commission
    const fM = t.match(/(?:usd|\$)\s*([\d][\d,\.]*)\s*\/?\s*(?:mt|pmt|per mt)/i); if (fM) { ex.freight = fM[1].replace(/,/g, ""); ex.freightBasis = "Per MT"; }
    const cM = t.match(/([\d.]+)\s*%\s*(?:ttl|comm|commission)/i); if (cM) ex.commissionPct = cM[1];
    return ex;
  }
  function exToPatch(ex, state) {
    const p = {};
    if (ex.commodity) p.commodity = { name: ex.commodity, form: ex.form || "dry-bulk", packaging: ex.packaging || (state.commodity && state.commodity.packaging) || "" };
    if (ex.qtyMt || ex.molooPct) p.quantity = { ...(state.quantity || {}), qtyMt: ex.qtyMt || (state.quantity && state.quantity.qtyMt) || "", unit: (state.quantity && state.quantity.unit) || "CbM", molooPct: ex.molooPct || (state.quantity && state.quantity.molooPct) || "", optionHolder: (state.quantity && state.quantity.optionHolder) || "MOLOO" };
    if (ex.pol || ex.pod) p.ports = { ...(state.ports || {}), pol: ex.pol || (state.ports && state.ports.pol), pod: ex.pod || (state.ports && state.ports.pod) };
    if (ex.laycanFrom || ex.freight || ex.commissionPct) p.terms = { ...(state.terms || {}), laycanFrom: ex.laycanFrom || (state.terms && state.terms.laycanFrom) || "", laycanTo: ex.laycanTo || (state.terms && state.terms.laycanTo) || "", freight: ex.freight || (state.terms && state.terms.freight) || "", freightBasis: ex.freightBasis || (state.terms && state.terms.freightBasis) || "Per MT", commissionPct: ex.commissionPct || (state.terms && state.terms.commissionPct) || "" };
    return p;
  }
  function exRows(ex) {
    const rows = [];
    if (ex.commodity) rows.push(["Commodity", ex.commodity + (ex.form ? " (" + (ex.form === "break-bulk" ? "break-bulk" : "dry bulk") + ")" : "")]);
    if (ex.qtyMt) rows.push(["Quantity", nf(ex.qtyMt) + " MT" + (ex.molooPct ? " +/- " + ex.molooPct + "%" : "")]);
    if (ex.pol) rows.push(["Load", ex.pol.name]);
    if (ex.pod) rows.push(["Discharge", ex.pod.name]);
    if (ex.laycanFrom) rows.push(["Laycan", ex.laycanFrom + (ex.laycanTo ? " to " + ex.laycanTo : "")]);
    if (ex.freight) rows.push(["Freight idea", "USD " + ex.freight + "/MT"]);
    if (ex.commissionPct) rows.push(["Commission", ex.commissionPct + "%"]);
    return rows;
  }

  function BosunAgent({ onApply }) {
    const [open, setOpen] = useState(false);
    const [input, setInput] = useState("");
    const [busy, setBusy] = useState(false);
    const [msgs, setMsgs] = useState(() => [
      { id: "greet", role: "bosun", kind: "text", text: "Ahoy, I'm Foreman. Paste a cargo circular below and I'll read it and fill the form for you to check." },
      { id: "actions", role: "bosun", kind: "actions" },
    ]);
    const threadRef = useRef(null);
    const inputRef = useRef(null);
    useEffect(() => { const el = threadRef.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs, open]);
    useEffect(() => { const h = () => setOpen(true); window.addEventListener("pc2-bosun-open", h); return () => window.removeEventListener("pc2-bosun-open", h); }, []);

    const respond = (ex, userText) => {
      setBusy(true);
      setMsgs((m) => [...m, { id: uid(), role: "user", kind: "text", text: userText }, { id: "typing", role: "bosun", kind: "typing" }]);
      setTimeout(() => {
        const ok = ex && (ex.commodity || ex.qtyMt || ex.pol);
        setMsgs((m) => m.filter((x) => x.id !== "typing").concat(ok
          ? [{ id: uid(), role: "bosun", kind: "text", text: "Aye, here's what I read. Check it over and hit Apply and I'll fill the form." }, { id: uid(), role: "bosun", kind: "result", ex }]
          : [{ id: uid(), role: "bosun", kind: "text", text: "I couldn't find cargo details in that. Paste a fuller circular with commodity, quantity and ports." }]));
        setBusy(false);
      }, 750);
    };
    const send = () => { const v = input.trim(); if (!v || busy) return; setInput(""); respond(parseCircular(v), v); };
    const onKey = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } };
    const applyEx = (ex) => { onApply(ex); setMsgs((m) => [...m, { id: uid(), role: "bosun", kind: "text", text: "Done. I've filled the form from what I read. Please review each step and confirm before you post." }]); };

    if (!open) {
      return (
        <button className="pp2-fab" type="button" onClick={() => setOpen(true)} aria-label="Open Foreman AI assistant">
          <span className="pp2-fab__ava">{Icon ? <Icon name="Cargo" size={20} /> : "AI"}<span className="pp2-fab__dot" /></span>
          <span className="pp2-fab__label"><b>Ask Foreman</b><span>Smart Assistant</span></span>
        </button>
      );
    }
    return (
      <div className="pp2-agent" role="dialog" aria-label="Foreman AI assistant">
        <div className="pp2-agent__head">
          <span className="pp2-agent__ava">{Icon ? <Icon name="Cargo" size={20} /> : "AI"}<span className="pp2-fab__dot" /></span>
          <div className="pp2-agent__id"><div className="pp2-agent__name">Foreman AI</div><div className="pp2-agent__role">Smart Assistant</div></div>
          <button className="pp2-agent__x" type="button" onClick={() => setOpen(false)} aria-label="Close">{Icon ? <Icon name="Close" size={16} /> : "X"}</button>
        </div>
        <div className="pp2-agent__thread" ref={threadRef}>
          {msgs.map((m) => {
            if (m.kind === "actions") return (
              <div className="pp2-agent__chips" key={m.id}>
                <button className="pp2-agent__chip" type="button" onClick={() => inputRef.current && inputRef.current.focus()}>{Icon ? <Icon name="Doc" size={13} /> : null} Paste a circular</button>
                <button className="pp2-agent__chip pp2-agent__chip--link" type="button" onClick={() => { setInput(SAMPLE_CIRCULAR); inputRef.current && inputRef.current.focus(); }}>Try a sample</button>
              </div>
            );
            if (m.kind === "typing") return (
              <div className="pp2-msg pp2-msg--bosun" key={m.id}><span className="pp2-msg__ava">{Icon ? <Icon name="Cargo" size={14} /> : null}</span><span className="pp2-msg__bubble"><span className="pp2-agent__typing"><i /><i /><i /></span></span></div>
            );
            if (m.kind === "result") return (
              <div className="pp2-msg pp2-msg--bosun" key={m.id}>
                <span className="pp2-msg__ava">{Icon ? <Icon name="Cargo" size={14} /> : null}</span>
                <div className="pp2-extract">
                  <div className="pp2-extract__h">Read from circular</div>
                  <div className="pp2-extract__rows">{exRows(m.ex).map((r, i) => <div className="pp2-extract__row" key={i}><span className="pp2-extract__k">{r[0]}</span><span className="pp2-extract__v">{r[1]}</span></div>)}</div>
                  <div className="pp2-extract__apply"><Button variant="primary" onClick={() => applyEx(m.ex)}>Apply to form</Button></div>
                </div>
              </div>
            );
            return (
              <div className={"pp2-msg pp2-msg--" + m.role} key={m.id}>{m.role === "bosun" && <span className="pp2-msg__ava">{Icon ? <Icon name="Cargo" size={14} /> : null}</span>}<span className="pp2-msg__bubble">{m.text}</span></div>
            );
          })}
        </div>
        <div className="pp2-agent__foot">
          <textarea ref={inputRef} className="pp2-agent__input" rows={1} placeholder="Paste a cargo circular, or type a note..." value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKey} />
          <button className="pp2-agent__send" type="button" onClick={send} disabled={!input.trim() || busy} aria-label="Send"><SendSVG /></button>
        </div>
      </div>
    );
  }

  function Placeholder({ hint }) { return <div className="pp2-placeholder"><span className="pp2-placeholder__dot" />{hint}</div>; }

  function PostCargo2() {
    const [state, setState] = useState(() => ({}));
    const patch = (u) => setState((s) => ({ ...s, ...u }));

    const steps = [
      { id: "commodity", title: "Commodity", hint: "What she's carrying, dry-bulk or break-bulk" },
      { id: "quantity", title: "Quantity", hint: "Weight, volume, and tolerance" },
      { id: "ports", title: "Load & discharge", hint: "POL, POD, and cargo rates" },
      { id: "terms", title: "Laycan & terms", hint: "Laycan, NOR, freight, commission" },
      { id: "review", title: "Review & submit", hint: "Summary, then post the cargo" },
    ];

    const [current, setCurrent] = useState(0);
    const stepDef = (id) => (window.PC2Steps || {})[id] || {};
    const isStepComplete = (s) => { const d = stepDef(s.id); return d.complete ? d.complete(state) : true; };
    const openStep = (i) => setCurrent((c) => (c === i ? -1 : i));
    const advance = (i) => setCurrent(i + 1 < steps.length ? i + 1 : -1);
    const goBack = (i) => setCurrent(i - 1 >= 0 ? i - 1 : 0);
    const allComplete = steps.every(isStepComplete);

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
        {window.DemoTierSwitch ? React.createElement(window.DemoTierSwitch) : null}
        <header className="pp2-head">
          <div className="pp2-head__top">
            <span className="pp2-head__icon">{Icon ? <Icon name="Cargo" size={34} /> : null}</span>
            <div className="pp2-head__text">
              <div className="pp2-eyebrow">Post Cargo</div>
              <h1 className="pp2-title">Post a cargo</h1>
            </div>
          </div>
          <p className="pp2-sub">Give us the essentials: the commodity, how much, and the lane. Name the cargo and pick dry-bulk or break-bulk; the platform classifies the IMSBC group, stowage and safety for you. Foreman AI can read a circular and fill it all in.</p>
          <div className="pp2-progress">
            <span className="pp2-progress__label">{completedCount} of {steps.length} complete</span>
            <div className="pp2-progress__bar"><div className="pp2-progress__fill" style={{ width: pct + "%" }} /></div>
          </div>
        </header>

        <div className="pp2-steps">
          {steps.map((s, i) => {
            const active = current === i, isDone = isStepComplete(s);
            const def = (window.PC2Steps || {})[s.id] || {};
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
                    <Button variant="primary" onClick={() => advance(i)} disabled={i === steps.length - 1 ? !allComplete : false}>{i === steps.length - 1 ? "Submit cargo" : "Continue"}</Button>
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

  window.PagePostCargo2 = PostCargo2;
  window.PC2Bosun = BosunAgent;
  window.PC2exToPatch = exToPatch;
  window.PC2parse = parseCircular;
  window.PC2exRows = exRows;
  window.PC2sample = SAMPLE_CIRCULAR;
  const mount = document.getElementById("pc2-root");
  if (mount) ReactDOM.createRoot(mount).render(<PostCargo2 />);
})();
