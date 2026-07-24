"use client";

// Post Cargo — Commodity step. Ported from reference/handoff/asb/pc2-steps.jsx.
// T3/T4: split smart search with a live classification readout (DB-backed,
// server-gated). T1/T2: plain picker with a locked teaser.

import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { useViewerTier } from "@/lib/portal/tier";
import {
  classifyCommodity,
  searchCommodityNames,
  type ClassificationReadout,
  type CommodityNameHit,
} from "@/sdk/app/ledger";
import type { StepCtx } from "../../types";
import type { CargoState } from "../state";
import { Field, InlineNote, SelectTip } from "../../fields";
import { SegmentedToggle, Icon } from "../../ds";
import { CARGOFORM_DEFS, LEDGER_ENUMS } from "../../defs";

const srcMeta = (c: CommodityNameHit) => {
  if (c.source === "imsbc") return "IMSBC · Group " + (c.group_or_cat || "C") + " · dry bulk";
  if (c.source === "grain") return "Grain Code · dry bulk";
  if (c.source === "css") return (c.group_or_cat ? c.group_or_cat + " · " : "") + "CSS break-bulk";
  if (c.source === "market") return c.regime === "CSS" ? "market name · break-bulk" : "market name · dry bulk";
  return c.form === "break-bulk" ? "break-bulk" : "dry bulk";
};

const isMulti = (c: CommodityNameHit) => c.regime === "UNMAPPED";

function ClsRow({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="pp2-cls__row">
      <span className="pp2-cls__k">{label}</span>
      <span className={"pp2-cls__v pp2-cls__v--" + (tone || "neutral")}>{value}</span>
    </div>
  );
}

const REGIME_LABEL: Record<string, string> = {
  GRAIN: "International Grain Code",
  IMSBC: "IMSBC Code (solid bulk)",
  CSS: "CSS Code (break-bulk)",
  UNMAPPED: "Resolved on posting",
};

function Classification({ name, readout }: { name: string; readout: ClassificationReadout | null }) {
  if (!readout || !readout.matched) {
    return (
      <div className="pp2-cmdx__empty">
        <Icon name="Cargo" size={26} />
        <span>{readout ? "Not yet classified — the platform resolves it on posting." : "Reading the ASB cargo database…"}</span>
      </div>
    );
  }
  const grp = (readout.group_or_cat || "").toUpperCase().replace(/\s*AND\s*/g, " & ");
  return (
    <div className="pp2-cls">
      <div className="pp2-cls__hd">
        <div className="pp2-cls__name">{readout.official_name || name}</div>
        <div className="pp2-cls__regime">
          {REGIME_LABEL[readout.regime || "UNMAPPED"]}
          {grp && readout.regime === "IMSBC" ? " · Group " + grp : ""}
        </div>
      </div>
      <div className="pp2-cls__rows">
        <ClsRow label="Cargo form" tone="info" value={readout.is_break_bulk ? "Break-bulk" : "Dry bulk"} />
        <ClsRow
          label="Classification"
          tone="info"
          value={readout.is_break_bulk ? readout.css_category || "CSS" : readout.is_grain ? "Grain" : "Solid bulk cargo"}
        />
        <ClsRow label="UN number" tone={readout.un_number ? "amber" : "ok"} value={readout.un_number ? "UN " + readout.un_number : "None assigned"} />
        <ClsRow label="Dangerous goods (DG)" tone={readout.is_dg ? "danger" : "ok"} value={readout.is_dg ? "Yes, UN-listed" : "No"} />
        <ClsRow label="MHB" tone={readout.is_mhb ? "amber" : "ok"} value={readout.is_mhb ? "Yes, hazardous in bulk" : "No"} />
      </div>
      {readout.liquefaction ? (
        <div className="pp2-cls__flag">
          <span>Group A, may liquefy. Moisture content / TML certificate required at load.</span>
        </div>
      ) : null}
      <div className="pp2-cls__src">
        <span>Read live from the ASB cargo database. Final group, stowage factor and safety controls are confirmed on posting.</span>
      </div>
    </div>
  );
}

export function CommodityStep({ state, patch }: StepCtx<CargoState>) {
  const tier = useViewerTier();
  const smart = tier === "T3" || tier === "T4";
  const [q, setQ] = useState("");
  const [results, setResults] = useState<CommodityNameHit[]>([]);
  const [focus, setFocus] = useState<CommodityNameHit | null>(null);
  const [readout, setReadout] = useState<{ name: string; readout: ClassificationReadout } | null>(null);
  const [gated, setGated] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cur = state.commodity;

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      if (q.trim().length < 2) {
        setResults([]);
        return;
      }
      try {
        const supabase = getSupabaseBrowserClient();
        setResults(await searchCommodityNames(supabase, q, smart ? 40 : 10));
      } catch {
        setResults([]);
      }
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q, smart]);

  // Live readout for the focused/selected commodity (T3/T4 only; server-gated).
  // Keyed by commodity name so a stale readout is never shown while loading.
  const previewName = focus?.display_name || cur?.name || results[0]?.display_name || null;
  useEffect(() => {
    if (!smart || !previewName) return;
    let alive = true;
    (async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        const res = await classifyCommodity(supabase, previewName);
        if (!alive) return;
        if (res.gated) setGated(true);
        else setReadout({ name: previewName, readout: res.readout });
      } catch {
        /* keep the previous readout on transient errors */
      }
    })();
    return () => {
      alive = false;
    };
  }, [previewName, smart]);

  const choose = (c: CommodityNameHit) => {
    patch({
      commodity: {
        name: c.display_name,
        form: c.form,
        source: c.source,
        group: c.group_or_cat,
        regime: c.regime,
        multi: isMulti(c),
        marketName: c.source === "market" ? c.display_name : null,
      },
    });
    setFocus(c);
  };
  const patchC = (u: Partial<NonNullable<CargoState["commodity"]>>) =>
    patch({ commodity: { ...(cur as NonNullable<CargoState["commodity"]>), ...u } });

  const fieldsBlock = cur ? (
    <div className="pp2-grid" style={{ marginTop: 15 }}>
      <Field label="Cargo type" req help="A coarse pick that helps the platform classify. Dry bulk loads loose in the hold; break-bulk is bagged, palletised or unitised.">
        <SegmentedToggle
          className="pp2-yn"
          value={cur.form || ""}
          onChange={(x) => patchC({ form: x as "dry-bulk" | "break-bulk" })}
          options={[
            { value: "dry-bulk", label: "Dry bulk" },
            { value: "break-bulk", label: "Break-bulk" },
          ]}
        />
      </Field>
      <Field label="Packaging / form" help="Optional. How it presents on board.">
        <SelectTip value={cur.packaging} onChange={(x) => patchC({ packaging: x })} options={[...LEDGER_ENUMS.cargoForm]} defs={CARGOFORM_DEFS} placeholder="Select…" />
      </Field>
    </div>
  ) : null;

  const multiNote =
    cur?.multi ? (
      <InlineNote tone="alert">This looks like a multi-parcel entry. Post each parcel as a separate cargo so the platform can classify each one.</InlineNote>
    ) : null;

  // ── T3/T4: split smart search + live classification ──
  if (smart && !gated) {
    const preview = focus || (cur ? ({ display_name: cur.name } as CommodityNameHit) : null) || results[0] || null;
    return (
      <div className="pp2-cmdx-wrap">
        <div className="pp2-cmdx">
          <div className="pp2-cmdx__left">
            <div className="pp2-cmdx__search">
              <Icon name="Search" size={16} />
              <input value={q} placeholder="Search commodity, e.g. Wheat, DAP, Steel Coils…" onChange={(e) => setQ(e.target.value)} />
              {q ? (
                <button type="button" className="pp2-cmdx__clear" onClick={() => setQ("")}>
                  Clear
                </button>
              ) : null}
            </div>
            <div className="pp2-cmdx__list">
              {results.map((c) => (
                <button
                  type="button"
                  key={c.display_name + c.source}
                  className={
                    "pp2-cmdx__opt" +
                    (cur && cur.name === c.display_name ? " is-sel" : "") +
                    (preview && preview.display_name === c.display_name ? " is-focus" : "")
                  }
                  onMouseEnter={() => setFocus(c)}
                  onFocus={() => setFocus(c)}
                  onClick={() => choose(c)}
                >
                  <span className="pp2-cmdx__opt-name">{c.display_name}</span>
                  <span className="pp2-cmdx__opt-meta">{srcMeta(c)}</span>
                </button>
              ))}
              {q.trim() && results.length === 0 ? (
                <div className="pp2-port__empty">No commodity matches “{q}”. Type the trade name and pick the nearest, or let Foreman read a circular.</div>
              ) : null}
              {!q.trim() ? (
                <div className="pp2-cmdx__hint">
                  <span>Start typing to search the ASB classified-cargo database.</span>
                </div>
              ) : null}
            </div>
          </div>
          <div className="pp2-cmdx__right">
            {preview ? (
              <Classification name={preview.display_name} readout={readout?.name === preview.display_name ? readout.readout : null} />
            ) : (
              <div className="pp2-cmdx__empty">
                <Icon name="Cargo" size={26} />
                <span>Search and hover a commodity to see its live IMSBC / Grain Code classification.</span>
              </div>
            )}
          </div>
        </div>
        {cur ? (
          <div className="pp2-cmdx__sel">
            <span className="pp2-cmdx__seldot" />
            <span>
              <strong>{cur.name}</strong> selected · {cur.form === "break-bulk" ? "Break-bulk" : "Dry bulk"}
            </span>
            <button
              type="button"
              className="pp2-vcard__change"
              onClick={() => {
                patch({ commodity: null });
                setFocus(null);
              }}
            >
              Change
            </button>
          </div>
        ) : null}
        {multiNote}
        {fieldsBlock}
      </div>
    );
  }

  // ── T1/T2: simple search (smart preview locked) ──
  if (!cur) {
    return (
      <div className="pp2-fleet">
        <input
          className="pp2-select"
          style={{ backgroundImage: "none" }}
          value={q}
          placeholder="Search commodity, e.g. Wheat, Sugar, Steel Coils…"
          onChange={(e) => setQ(e.target.value)}
        />
        {q.trim() ? (
          <div className="pp2-port__menu" style={{ position: "static", boxShadow: "none", marginTop: 2 }}>
            {results.map((c) => (
              <button type="button" className="pp2-port__opt" key={c.display_name + c.source} onClick={() => choose(c)}>
                <span className="pp2-port__opt-name">{c.display_name}</span>
                <span className="pp2-port__opt-meta">
                  {srcMeta(c)}
                  {isMulti(c) ? " · multi-parcel" : ""}
                </span>
              </button>
            ))}
            {results.length === 0 && (
              <div className="pp2-port__empty">No commodity matches “{q}”. Type the trade name and pick the nearest, or let Foreman read a circular.</div>
            )}
          </div>
        ) : (
          <div className="pp2-fleet__hint">
            <span>Start typing the commodity trade name to find it.</span>
          </div>
        )}
        <div className="pp2-cmdx__locked">
          <span>
            Live cargo classification (dry/break, Grain vs IMSBC, UN number, DG, MHB) is available from <strong>Subscriber tier (T3+)</strong>.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="pp2-commodity">
      <div className="pp2-vcard" style={{ marginBottom: 15 }}>
        <div className="pp2-vcard__top">
          <div>
            <div className="pp2-vcard__name">{cur.name}</div>
            <div className="pp2-vcard__imo">{cur.source ? srcMeta({ display_name: cur.name, source: cur.source, regime: cur.regime, group_or_cat: cur.group, form: cur.form } as CommodityNameHit) + " · " : ""}resolved by the platform</div>
          </div>
          <button type="button" className="pp2-vcard__change" onClick={() => patch({ commodity: null })}>
            Change
          </button>
        </div>
      </div>
      {fieldsBlock}
      {multiNote}
      <InlineNote>IMSBC group, stowage factor and safety controls are resolved by the platform once you post.</InlineNote>
    </div>
  );
}

export function commoditySummary(s: CargoState): string {
  const c = s.commodity;
  if (!c) return "Not set";
  return c.name + " · " + (c.form === "break-bulk" ? "break-bulk" : "dry bulk");
}

export function commodityComplete(s: CargoState): boolean {
  return !!(s.commodity && s.commodity.name && s.commodity.form);
}
