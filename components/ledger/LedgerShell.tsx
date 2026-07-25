"use client";

// Broker Ledger shell — Concept 4 "Professional Broker Ledger".
// Typed 1:1 port of reference/handoff/asb/ledger-shell.jsx: dense,
// keyboard-first collapsing sections + right rail (weighted completion ring,
// per-section todo, saved drafts, recent-value chips, repost rows), autosave.
// No form logic here — steps come in via LedgerConfig (state + patch model).

import * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DraftEntry, LedgerConfig, LedgerStepDef } from "./types";
import {
  clearWorkingState,
  loadDrafts,
  loadWorkingState,
  saveDrafts as persistDrafts,
  saveWorkingState,
} from "./drafts";
import { Icon, LedgerButton } from "./ds";

const CheckSVG = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="5,12 10,17 19,7" />
  </svg>
);

function Ring({ pct }: { pct: number }) {
  const r = 24;
  const c = 2 * Math.PI * r;
  const off = c * (1 - pct / 100);
  return (
    <svg className="led-ring" viewBox="0 0 60 60" width="60" height="60" aria-hidden="true">
      <circle cx="30" cy="30" r={r} className="led-ring__t" />
      <circle cx="30" cy="30" r={r} className="led-ring__f" strokeDasharray={c} strokeDashoffset={off} />
      <text x="30" y="31" className="led-ring__n">
        {pct}%
      </text>
    </svg>
  );
}

const timeStr = (ts: number) => {
  const d = new Date(ts);
  return (
    d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) +
    " " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  );
};

export function LedgerShell<S extends object>({ config: cfg }: { config: LedgerConfig<S> }) {
  const steps = cfg.steps;

  const [state, setState] = useState<S>(() => cfg.initialState());
  const [hydrated, setHydrated] = useState(false);
  const [open, setOpen] = useState(0);
  const [saved, setSaved] = useState<"saved" | "saving">("saved");
  const [toast, setToast] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<DraftEntry<S>[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const first = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Hydrate the working state + drafts from localStorage after mount (SSR-safe).
  useEffect(() => {
    const persisted = loadWorkingState<S>(cfg.storageKey);
    if (persisted) setState(persisted);
    setDrafts(loadDrafts<S>(cfg.storageKey));
    setHydrated(true);
  }, [cfg.storageKey]);

  const patch = useCallback((u: Partial<S>) => setState((s) => ({ ...s, ...u })), []);
  // Always-current state for callbacks that fire outside the render cycle
  // (e.g. the assistant's post-apply section jump).
  const stateRef = useRef(state);
  stateRef.current = state;
  const flash = useCallback((m: string) => {
    setToast(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  // Debounced autosave with the saving/saved indicator.
  useEffect(() => {
    if (!hydrated) return;
    if (first.current) {
      first.current = false;
      return;
    }
    setSaved("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      saveWorkingState(cfg.storageKey, state);
      setSaved("saved");
    }, 600);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, hydrated]);

  const isComplete = (d: LedgerStepDef<S>) => (d.complete ? d.complete(state) : true);
  const done = steps.filter((s) => isComplete(s)).length;
  const allComplete = done === steps.length;

  // Weighted completeness: mandatory ×2, optional ×1; null predicate = N/A.
  const Wm = 2;
  const Wo = 1;
  const secProg = (s: LedgerStepDef<S>) => {
    const mand = s.mand ?? null;
    const opt = s.opt ?? [];
    let md = 0,
      mt = 0,
      od = 0,
      ot = 0;
    if (mand) {
      mand.forEach((fn) => {
        const r = fn(state);
        if (r == null) return;
        mt++;
        if (r) md++;
      });
    } else {
      mt = 1;
      md = isComplete(s) ? 1 : 0;
    }
    opt.forEach((fn) => {
      const r = fn(state);
      if (r == null) return;
      ot++;
      if (r) od++;
    });
    const denom = mt * Wm + ot * Wo;
    const num = md * Wm + od * Wo;
    return { pct: denom ? Math.round((num / denom) * 100) : 100, mandComplete: md === mt };
  };
  // The sidebar's checkmarks/ring agree with the submit gate: a section is
  // "done" per its complete() rule (progressDone overrides for advisory
  // sections that never block posting but shouldn't show done while empty).
  // The ring counts EVERY accordion item — including Review — so "N sections"
  // matches what the user sees and each item carries an equal share.
  const sectionDone = (s: LedgerStepDef<S>) =>
    s.progressDone ? s.progressDone(state) : s.complete ? s.complete(state) : secProg(s).mandComplete;
  const doneSecs = steps.filter(sectionDone).length;
  const ringPct = steps.length ? Math.round((doneSecs / steps.length) * 100) : 0;

  const toggle = (i: number) => setOpen((o) => (o === i ? -1 : i));

  const writeDrafts = (list: DraftEntry<S>[]) => {
    setDrafts(list);
    persistDrafts(cfg.storageKey, list);
  };
  const draftLabel = () => cfg.draftLabel(state) || "Untitled draft";

  // Save = keep the current draft in the saved list AND persist working state.
  const saveDraft = useCallback(() => {
    const id = currentId || "d" + Date.now();
    const entry: DraftEntry<S> = { id, label: draftLabel(), ts: Date.now(), doneN: done, total: steps.length, state };
    const list = drafts.slice();
    const i = list.findIndex((d) => d.id === id);
    if (i >= 0) list[i] = entry;
    else list.unshift(entry);
    if (!currentId) setCurrentId(id);
    writeDrafts(list);
    saveWorkingState(cfg.storageKey, state);
    setSaved("saved");
    flash("Draft saved");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, drafts, state, done, steps.length]);

  const loadDraft = (d: DraftEntry<S>) => {
    setState(d.state);
    setCurrentId(d.id);
    setOpen(0);
    flash("Draft loaded");
  };
  const deleteDraft = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    writeDrafts(drafts.filter((d) => d.id !== id));
    if (currentId === id) setCurrentId(null);
  };

  // New: keep current work safe (auto-save to drafts) before starting blank.
  const newDraft = () => {
    const s = state as Record<string, unknown>;
    const hasData = Object.keys(s).some((k) => s[k] != null && s[k] !== "" && k !== "entryMode");
    if (hasData) {
      const id = currentId || "d" + Date.now();
      const entry: DraftEntry<S> = { id, label: draftLabel(), ts: Date.now(), doneN: done, total: steps.length, state };
      const list = drafts.slice();
      const i = list.findIndex((d) => d.id === id);
      if (i >= 0) list[i] = entry;
      else list.unshift(entry);
      writeDrafts(list);
    }
    setState(cfg.initialState());
    setCurrentId(null);
    setOpen(0);
    flash(hasData ? "Saved to drafts · new draft started" : "New draft started");
  };

  const applyPatch = useCallback(
    (p: Partial<S> | ((s: S) => Partial<S>), msg?: string) => {
      setState((s) => ({ ...s, ...(typeof p === "function" ? p(s) : p) }));
      if (msg) flash(msg);
    },
    [flash],
  );

  // Duplicate: deep-copy current values into a brand-new saved draft.
  const duplicate = () => {
    const copy = JSON.parse(JSON.stringify(state)) as S;
    const id = "d" + Date.now();
    const entry: DraftEntry<S> = { id, label: draftLabel() + " (copy)", ts: Date.now(), doneN: done, total: steps.length, state: copy };
    writeDrafts([entry, ...drafts]);
    setState(copy);
    setCurrentId(id);
    setOpen(0);
    flash("Duplicated — editing the copy");
  };

  // Post: submit through the config, then drop the draft and start fresh.
  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const msg = await cfg.onSubmit(state);
      if (currentId) writeDrafts(drafts.filter((d) => d.id !== currentId));
      setCurrentId(null);
      clearWorkingState(cfg.storageKey);
      flash(msg || cfg.submitToast || "Posted");
      setState(cfg.initialState());
      setOpen(0);
    } catch (err) {
      flash(err instanceof Error ? err.message : "Posting failed — draft kept");
    } finally {
      setSubmitting(false);
    }
  };

  // Keyboard: ArrowUp/Down move between section heads, Ctrl/Cmd+S saves.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = ((e.target as HTMLElement)?.tagName || "").toLowerCase();
      const typing = tag === "input" || tag === "textarea" || tag === "select";
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveDraft();
        return;
      }
      if (typing) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const heads = Array.from(el.querySelectorAll<HTMLElement>(".pp2-step__head"));
        const idx = heads.indexOf(document.activeElement as HTMLElement);
        const nxt = e.key === "ArrowDown" ? Math.min(heads.length - 1, idx + 1) : Math.max(0, idx - 1);
        if (heads[nxt]) {
          heads[nxt].focus();
          e.preventDefault();
        }
      }
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [saveDraft]);

  const savedLabel = saved === "saving" ? "Saving…" : "Autosaved";
  const savedTitle =
    "Your draft autosaves to this browser as you type and is restored when you " +
    "come back to this page. Nothing is posted until you press " +
    cfg.submitLabel +
    ". Use Save draft to also pin it in the Saved drafts list.";

  return (
    <div className="led pp2" ref={rootRef}>
      <header className="led-head">
        <div className="led-head__id">
          <span className="led-head__icon">{cfg.icon ? <Icon name={cfg.icon} size={26} /> : null}</span>
          <div>
            <div className="led-head__eyebrow">{cfg.eyebrow}</div>
            <h1 className="led-head__title">{cfg.title}</h1>
            {cfg.subtitle ? <p className="led-head__sub">{cfg.subtitle}</p> : null}
          </div>
        </div>
        <div className="led-head__meta">
          <button className="led-act led-act--save" type="button" onClick={saveDraft}>
            Save draft
          </button>
          <button className="led-act" type="button" onClick={duplicate}>
            Duplicate
          </button>
          <button className="led-act" type="button" onClick={newDraft}>
            New
          </button>
          <span className={"led-save led-save--" + saved} title={savedTitle}>
            <span className="led-save__dot" />
            {savedLabel}
          </span>
          <a className="led-act led-act--exit" href={cfg.exitHref}>
            Exit
          </a>
        </div>
      </header>

      <div className="led-body">
        <main className="led-main">
          <div className="pp2-steps">
            {steps.map((s, i) => {
              const cmpl = isComplete(s);
              const active = open === i;
              const summary = cmpl && s.summary ? s.summary(state) : null;
              const cls = ["pp2-step", active && "is-active", cmpl && "is-done"].filter(Boolean).join(" ");
              return (
                <section className={cls} key={s.id}>
                  <button className="pp2-step__head" type="button" onClick={() => toggle(i)} aria-expanded={active}>
                    <span className="pp2-step__num">{cmpl && !active ? <CheckSVG /> : i + 1}</span>
                    <span className="pp2-step__titles">
                      <span className="pp2-step__title">{s.title}</span>
                      {!active && <span className={"pp2-step__summary" + (cmpl ? "" : " is-hint")}>{summary || s.hint}</span>}
                    </span>
                    <span className="pp2-step__chev">
                      <Icon name="Caret" size={16} />
                    </span>
                  </button>
                  <div className="pp2-step__bodywrap">
                    <div className="pp2-step__bodyinner">
                      <div className="pp2-step__body">{s.render({ state, patch })}</div>
                    </div>
                  </div>
                </section>
              );
            })}
          </div>

          <div className="led-submit">
            <LedgerButton variant="primary" onClick={submit} disabled={!allComplete || submitting}>
              {submitting ? "Posting…" : cfg.submitLabel}
            </LedgerButton>
            {!allComplete ? (
              <span className="led-submit__note">
                Complete all sections to post ({steps.length - done} left).
              </span>
            ) : null}
          </div>
        </main>

        <aside className="led-side">
          <section className="led-card led-quality">
            <div className="led-quality__top">
              <Ring pct={ringPct} />
              <div className="led-quality__meta">
                <div className="led-quality__lead">
                  {doneSecs} of {steps.length} sections
                </div>
                <div className="led-quality__sub">{allComplete ? "Ready to post" : "Sections complete"}</div>
              </div>
            </div>
            {steps.length ? (
              <ul className="led-todo">
                {steps.map((s) => {
                  const p = secProg(s);
                  const isDone = sectionDone(s);
                  return (
                    <li key={s.id}>
                      <button type="button" className={isDone ? "is-done" : ""} onClick={() => setOpen(steps.indexOf(s))}>
                        <span className="led-todo__pipe">{isDone ? <CheckSVG /> : null}</span>
                        <span className="led-todo__name">{s.title}</span>
                        <span className="led-todo__pct">{p.pct}%</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </section>

          <section className="led-card">
            <div className="led-card__hrow">
              <span className="led-card__h">Saved drafts</span>
              <button className="led-newbtn" type="button" onClick={newDraft}>
                + New
              </button>
            </div>
            <div className="led-card__list">
              {drafts.length ? (
                drafts.map((d) => (
                  <div
                    className={"led-draft" + (d.id === currentId ? " is-current" : "")}
                    key={d.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => loadDraft(d)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") loadDraft(d);
                    }}
                  >
                    <div className="led-draft__txt">
                      <span className="led-draft__main">{d.label}</span>
                      <span className="led-draft__meta">
                        {d.doneN}/{d.total} complete · {timeStr(d.ts)}
                        {d.id === currentId ? " · current" : ""}
                      </span>
                    </div>
                    <button className="led-draft__x" type="button" onClick={(e) => deleteDraft(d.id, e)} aria-label="Delete draft">
                      ×
                    </button>
                  </div>
                ))
              ) : (
                <div className="led-empty">
                  No saved drafts yet. Press Save to keep this one; it stays here (and in this browser) until you post it.
                </div>
              )}
            </div>
          </section>

          {cfg.recents?.length ? (
            <section className="led-card">
              <div className="led-card__h">Recent values</div>
              <div className="led-card__list">
                {cfg.recents.map((r, i) => (
                  <button className="led-chip" type="button" key={i} onClick={() => applyPatch(r.patch, "Applied: " + r.label)}>
                    {r.label}
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {cfg.reposts?.length ? (
            <section className="led-card">
              <div className="led-card__h">Repost a past posting</div>
              <div className="led-card__list">
                {cfg.reposts.map((r, i) => (
                  <button
                    className="led-row"
                    type="button"
                    key={i}
                    onClick={() => {
                      applyPatch(r.patch, "Loaded for repost");
                      setCurrentId(null);
                      setOpen(0);
                    }}
                  >
                    <span className="led-row__main">{r.label}</span>
                    <span className="led-row__sub">{r.sub ?? "Loads all fields — edit then repost"}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
        </aside>
      </div>

      {cfg.assistant
        ? cfg.assistant({
            applyPatch,
            revealIncomplete: () => {
              const s = stateRef.current;
              const gap = steps.findIndex((st) => (st.complete ? !st.complete(s) : false));
              setOpen(gap === -1 ? steps.length - 1 : gap);
            },
          })
        : null}
      {toast ? (
        <div className="led-toast" role="status">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
