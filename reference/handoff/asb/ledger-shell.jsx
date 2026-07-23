// asb/ledger-shell.jsx — Concept 4: "Professional Broker Ledger".
// Dense, keyboard-first, collapsible sections. Reuses the exact step registries
// (window.PP2Steps / PC2Steps), validation, Bosun agent and exToPatch. No form logic here.
// Exposes window.mountBrokerLedger(cfg).
(function () {
  const { useState, useRef, useEffect, useCallback } = React;
  const DS = window.ASBDesignSystem_0955c8 || {};
  const { Button, Icon } = DS;

  const CheckSVG = () => (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="5,12 10,17 19,7" /></svg>
  );

  function Ring({ pct }) {
    const r = 24, c = 2 * Math.PI * r, off = c * (1 - pct / 100);
    return (
      <svg className="led-ring" viewBox="0 0 60 60" width="60" height="60" aria-hidden="true">
        <circle cx="30" cy="30" r={r} className="led-ring__t" />
        <circle cx="30" cy="30" r={r} className="led-ring__f" strokeDasharray={c} strokeDashoffset={off} />
        <text x="30" y="31" className="led-ring__n">{pct}%</text>
      </svg>
    );
  }
  const timeStr = (ts) => { const d = new Date(ts); return d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) + " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }); };

  function BrokerLedger(cfg) {
    return function Ledger() {
      const registry = () => window[cfg.registryKey] || {};
      const stepDef = (id) => registry()[id] || {};
      const steps = cfg.steps;

      const [state, setState] = useState(() => {
        try { const raw = localStorage.getItem(cfg.storageKey); if (raw) return JSON.parse(raw); } catch (e) {}
        return cfg.initialState ? cfg.initialState() : {};
      });
      const [open, setOpen] = useState(0);
      const [saved, setSaved] = useState("saved");
      const [toast, setToast] = useState(null);
      const draftsKey = cfg.storageKey + ".drafts";
      const [drafts, setDrafts] = useState(() => { try { return JSON.parse(localStorage.getItem(draftsKey)) || []; } catch (e) { return []; } });
      const [currentId, setCurrentId] = useState(null);
      const first = useRef(true), timer = useRef(null), rootRef = useRef(null);

      const patch = useCallback((u) => setState((s) => ({ ...s, ...u })), []);
      const flash = (m) => { setToast(m); setTimeout(() => setToast(null), 2000); };

      useEffect(() => {
        if (first.current) { first.current = false; return; }
        setSaved("saving"); clearTimeout(timer.current);
        timer.current = setTimeout(() => { try { localStorage.setItem(cfg.storageKey, JSON.stringify(state)); } catch (e) {} setSaved("saved"); }, 600);
        return () => clearTimeout(timer.current);
      }, [state]);

      const isComplete = (id) => { const d = stepDef(id); return d.complete ? d.complete(state) : true; };
      const done = steps.filter((s) => isComplete(s.id)).length;
      const allComplete = done === steps.length;

      // Weighted completeness: mandatory fields weigh more than optional ones.
      const Wm = 2, Wo = 1;
      const secProg = (s) => {
        const mand = s.mand || null, opt = s.opt || [];
        let md = 0, mt = 0, od = 0, ot = 0;
        // predicates may return true (filled) / false (empty) / null (not applicable → excluded)
        if (mand) { mand.forEach((fn) => { const r = fn(state); if (r == null) return; mt++; if (r) md++; }); }
        else { mt = 1; md = isComplete(s.id) ? 1 : 0; }
        opt.forEach((fn) => { const r = fn(state); if (r == null) return; ot++; if (r) od++; });
        const denom = mt * Wm + ot * Wo, num = md * Wm + od * Wo;
        return { pct: denom ? Math.round((num / denom) * 100) : 100, mandComplete: md === mt, md, mt, num, denom };
      };
      const nonReview = steps.filter((s) => s.id !== "review");
      const doneSecs = nonReview.filter((s) => secProg(s).mandComplete).length;
      const remaining = nonReview.filter((s) => !secProg(s).mandComplete);
      const ringPct = nonReview.length ? Math.round((doneSecs / nonReview.length) * 100) : 0;   // ring = sections complete

      const toggle = (i) => setOpen((o) => (o === i ? -1 : i));

      const writeDrafts = (list) => { setDrafts(list); try { localStorage.setItem(draftsKey, JSON.stringify(list)); } catch (e) {} };
      const draftLabel = () => (cfg.draftLabel && cfg.draftLabel(state)) || "Untitled draft";
      // Save = keep the current draft (create or update it) in the saved-drafts list AND persist
      // the working state to browser memory so it restores if the tab/page is closed.
      const saveDraft = () => {
        const id = currentId || ("d" + Date.now());
        const entry = { id, label: draftLabel(), ts: Date.now(), doneN: done, total: steps.length, state };
        const list = drafts.slice(); const i = list.findIndex((d) => d.id === id);
        if (i >= 0) list[i] = entry; else list.unshift(entry);
        if (!currentId) setCurrentId(id);
        writeDrafts(list);
        try { localStorage.setItem(cfg.storageKey, JSON.stringify(state)); } catch (e) {}
        setSaved("saved"); flash("Draft saved");
      };
      const loadDraft = (d) => { setState(d.state); setCurrentId(d.id); setOpen(0); flash("Draft loaded"); };
      const deleteDraft = (id, e) => { e.stopPropagation(); writeDrafts(drafts.filter((d) => d.id !== id)); if (currentId === id) setCurrentId(null); };
      // New: keep the current work safe (auto-save it to drafts) before clearing to a blank posting.
      const newDraft = () => {
        const hasData = Object.keys(state || {}).some((k) => state[k] != null && state[k] !== "" && k !== "entryMode");
        if (hasData) {
          const id = currentId || ("d" + Date.now());
          const entry = { id, label: draftLabel(), ts: Date.now(), doneN: done, total: steps.length, state };
          const list = drafts.slice(); const i = list.findIndex((d) => d.id === id);
          if (i >= 0) list[i] = entry; else list.unshift(entry);
          writeDrafts(list);
        }
        setState(cfg.initialState ? cfg.initialState() : {}); setCurrentId(null); setOpen(0);
        flash(hasData ? "Saved to drafts · new draft started" : "New draft started");
      };

      const applyPatch = (p, msg) => { setState((s) => ({ ...s, ...(typeof p === "function" ? p(s) : p) })); if (msg) flash(msg); };
      // Duplicate: deep-copy the current values into a brand-new saved draft (new id), keep editing the copy.
      const duplicate = () => {
        const copy = JSON.parse(JSON.stringify(state));
        const id = "d" + Date.now();
        const entry = { id, label: draftLabel() + " (copy)", ts: Date.now(), doneN: done, total: steps.length, state: copy };
        writeDrafts([entry, ...drafts]);
        setState(copy); setCurrentId(id); setOpen(0);
        flash("Duplicated — editing the copy");
      };
      // Post: drop the current draft from the unposted list, then start fresh.
      const submit = () => {
        if (currentId) writeDrafts(drafts.filter((d) => d.id !== currentId));
        setCurrentId(null); flash(cfg.submitToast || "Posted");
        setState(cfg.initialState ? cfg.initialState() : {}); setOpen(0);
      };

      // Bosun apply: jump to the first still-incomplete section
      const applyExtract = (ex) => {
        const f = window[cfg.exToPatchKey];
        applyPatch(f ? f(ex, state) : {}, "Applied from circular");
        const next = { ...state, ...(f ? f(ex, state) : {}) };
        const gap = steps.findIndex((st) => { const dd = stepDef(st.id); return dd.complete ? !dd.complete(next) : false; });
        setOpen(gap === -1 ? steps.length - 1 : gap);
      };

      // keyboard: ArrowUp/Down move between section heads, Cmd/Ctrl+S save
      useEffect(() => {
        const onKey = (e) => {
          const tag = (e.target.tagName || "").toLowerCase();
          const typing = tag === "input" || tag === "textarea" || tag === "select";
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); saveDraft(); return; }
          if (typing) return;
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            const heads = [...rootRef.current.querySelectorAll(".led-sec__head")];
            const idx = heads.indexOf(document.activeElement);
            const nxt = e.key === "ArrowDown" ? Math.min(heads.length - 1, idx + 1) : Math.max(0, idx - 1);
            if (heads[nxt]) { heads[nxt].focus(); e.preventDefault(); }
          }
        };
        const el = rootRef.current; el.addEventListener("keydown", onKey);
        return () => el.removeEventListener("keydown", onKey);
      }, [state]);

      const Bosun = window[cfg.bosunKey];
      const savedLabel = saved === "saving" ? "Saving…" : "Saved";

      return (
        <div className="led pp2" ref={rootRef}>
          {cfg.tierSwitch && window.DemoTierSwitch ? React.createElement(window.DemoTierSwitch) : null}
          <header className="led-head">
            <div className="led-head__id">
              <span className="led-head__icon">{Icon && cfg.icon ? <Icon name={cfg.icon} size={30} /> : null}</span>
              <div>
                <div className="led-head__eyebrow">{cfg.eyebrow}</div>
                <h1 className="led-head__title">{cfg.title}</h1>
                {cfg.subtitle ? <p className="led-head__sub">{cfg.subtitle}</p> : null}
              </div>
            </div>
            <div className="led-head__meta">
              <button className="led-act led-act--save" type="button" onClick={saveDraft}>Save draft</button>
              <button className="led-act" type="button" onClick={duplicate}>Duplicate</button>
              <button className="led-act" type="button" onClick={newDraft}>New</button>
              <span className={"led-save led-save--" + saved}><span className="led-save__dot" />{savedLabel}</span>
              <a className="led-act led-act--exit" href="design-gallery.html">Exit</a>
            </div>
          </header>

          <div className="led-body">
            <main className="led-main">
              <div className="pp2-steps">
              {steps.map((s, i) => {
                const d = stepDef(s.id), cmpl = isComplete(s.id), active = open === i;
                const summary = cmpl && d.summary ? d.summary(state) : null;
                const cls = ["pp2-step", active && "is-active", cmpl && "is-done"].filter(Boolean).join(" ");
                return (
                  <section className={cls} key={s.id}>
                    <button className="pp2-step__head" type="button" onClick={() => toggle(i)} aria-expanded={active}>
                      <span className="pp2-step__num">{cmpl && !active ? <CheckSVG /> : i + 1}</span>
                      <span className="pp2-step__titles">
                        <span className="pp2-step__title">{s.title}</span>
                        {!active && <span className={"pp2-step__summary" + (cmpl ? "" : " is-hint")}>{summary || s.hint}</span>}
                      </span>
                      <span className="pp2-step__chev">{Icon ? <Icon name="Caret" size={16} /> : "▾"}</span>
                    </button>
                    <div className="pp2-step__bodywrap"><div className="pp2-step__bodyinner"><div className="pp2-step__body">{d.render ? d.render({ state, patch }) : <p>{s.hint}</p>}</div></div></div>
                  </section>
                );
              })}
              </div>

              <div className="led-submit">
                <Button variant="primary" onClick={submit} disabled={!allComplete}>{cfg.submitLabel}</Button>
                {!allComplete ? <span className="led-submit__note">Complete all sections to post ({steps.length - done} left).</span> : null}
              </div>
            </main>

            <aside className="led-side">
              <section className="led-card led-quality">
                <div className="led-quality__top">
                  <Ring pct={ringPct} />
                  <div className="led-quality__meta">
                    <div className="led-quality__lead">{doneSecs} of {nonReview.length} sections</div>
                    <div className="led-quality__sub">{allComplete ? "Ready to post" : "Sections complete"}</div>
                  </div>
                </div>
                {nonReview.length ? (
                  <ul className="led-todo">
                    {nonReview.map((s) => {
                      const p = secProg(s);
                      return (
                        <li key={s.id}><button type="button" className={p.mandComplete ? "is-done" : ""} onClick={() => setOpen(steps.indexOf(s))}>
                          <span className="led-todo__pipe">{p.mandComplete ? <CheckSVG /> : null}</span>
                          <span className="led-todo__name">{s.title}</span>
                          <span className="led-todo__pct">{p.pct}%</span>
                        </button></li>
                      );
                    })}
                  </ul>
                ) : null}
              </section>

              <section className="led-card">
                <div className="led-card__hrow"><span className="led-card__h">Saved drafts</span><button className="led-newbtn" type="button" onClick={newDraft}>+ New</button></div>
                <div className="led-card__list">
                  {drafts.length ? drafts.map((d) => (
                    <div className={"led-draft" + (d.id === currentId ? " is-current" : "")} key={d.id} role="button" tabIndex={0} onClick={() => loadDraft(d)} onKeyDown={(e) => { if (e.key === "Enter") loadDraft(d); }}>
                      <div className="led-draft__txt"><span className="led-draft__main">{d.label}</span><span className="led-draft__meta">{d.doneN}/{d.total} complete · {timeStr(d.ts)}{d.id === currentId ? " · current" : ""}</span></div>
                      <button className="led-draft__x" type="button" onClick={(e) => deleteDraft(d.id, e)} aria-label="Delete draft">×</button>
                    </div>
                  )) : <div className="led-empty">No saved drafts yet. Press Save to keep this one; it stays here (and in this browser) until you post it.</div>}
                </div>
              </section>

              <section className="led-card">
                <div className="led-card__h">Recent values</div>
                <div className="led-card__list">
                  {(cfg.recents || []).map((r, i) => (
                    <button className="led-chip" type="button" key={i} onClick={() => applyPatch(r.patch, "Applied: " + r.label)}>{r.label}</button>
                  ))}
                </div>
              </section>

              {cfg.reposts && cfg.reposts.length ? (
                <section className="led-card">
                  <div className="led-card__h">Repost a past posting</div>
                  <div className="led-card__list">
                    {cfg.reposts.map((r, i) => (
                      <button className="led-row" type="button" key={i} onClick={() => { applyPatch(r.patch, "Loaded for repost"); setCurrentId(null); setOpen(0); }}>
                        <span className="led-row__main">{r.label}</span>
                        <span className="led-row__sub">Loads all fields — edit then repost</span>
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}
            </aside>
          </div>

          {Bosun ? <Bosun onApply={applyExtract} /> : null}
          {toast ? <div className="led-toast" role="status">{toast}</div> : null}
        </div>
      );
    };
  }

  window.mountBrokerLedger = function (cfg) {
    const mount = document.getElementById(cfg.rootId);
    if (mount) ReactDOM.createRoot(mount).render(React.createElement(BrokerLedger(cfg)));
  };
})();
