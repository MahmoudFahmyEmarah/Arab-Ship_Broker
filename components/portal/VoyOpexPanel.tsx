"use client";

// Voy OPEX Estimator — slide-over from the map right-bar. Tier-gated (locked for
// T1/T2 by the parent). Cost-group include pills (Voyage / PDAs / Suez) drive the
// grand total; module tabs (Port DAs · Bunker · Load-Disch · Suez Canal) show the
// per-group breakdown. Reuses lib/portal/econ.ts so the figures match the Voyage
// Estimator. A quick estimator — editable inputs, sensible defaults.
import * as React from "react";
import { calcPortDA, calcSuezToll, FUEL_PRICES, usd } from "@/lib/portal/econ";

type Tab = "pda" | "bunker" | "loaddisch" | "suez";
type Group = "voyage" | "pda" | "suez";

function NumInput({ label, value, onChange, suffix }: { label: string; value: number; onChange: (n: number) => void; suffix?: string }) {
  return (
    <label className="voy-field">
      <span>{label}</span>
      <span className="voy-field__in">
        <input type="number" value={Number.isFinite(value) ? value : 0} onChange={(e) => onChange(Number(e.target.value))} />
        {suffix && <em>{suffix}</em>}
      </span>
    </label>
  );
}

export function VoyOpexPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = React.useState<Tab>("pda");
  const [groups, setGroups] = React.useState<Record<Group, boolean>>({ voyage: true, pda: true, suez: true });
  // editable inputs
  const [days, setDays] = React.useState(4);
  const [qty, setQty] = React.useState(35000);
  const [seaDays, setSeaDays] = React.useState(12);
  const [scnrt, setScnrt] = React.useState(18000);
  const [laden, setLaden] = React.useState(true);

  const pda = calcPortDA({ days, qtyMT: qty, stevedoringAccount: "Charterer" });
  const suez = calcSuezToll({ scnrt, cargoStatus: laden ? "Laden" : "Ballast" });
  const bunkerVlsfo = seaDays * Number(FUEL_PRICES.vlsfo);
  const bunkerTotal = bunkerVlsfo; // VLSFO at sea; port LSMGO folded into PDA days
  const loadDischUsd = pda.usdIncl - pda.usdExcl; // stevedoring portion (illustrative)

  const total =
    (groups.voyage ? bunkerTotal : 0) +
    (groups.pda ? pda.usdExcl : 0) +
    (groups.suez ? suez.total : 0);

  if (!open) return null;
  const toggle = (g: Group) => setGroups((s) => ({ ...s, [g]: !s[g] }));

  return (
    <div className="voy-panel open">
      <div className="voy-panel__inner">
        <div className="voy-panel__head">
          <span className="voy-panel__title">Voy OPEX Estimator</span>
          <button type="button" className="voy-panel__close" onClick={onClose} aria-label="Close">×</button>
        </div>

        {/* cost-group include pills */}
        <div className="voy-pills">
          {(["voyage", "pda", "suez"] as Group[]).map((g) => (
            <button key={g} type="button" className={`voy-pill${groups[g] ? " is-on" : ""}`} onClick={() => toggle(g)}>
              {g === "voyage" ? "Voyage economics" : g === "pda" ? "PDAs" : "Suez"}
            </button>
          ))}
        </div>

        {/* module tabs */}
        <div className="voy-tabs">
          {([["pda", "Port DAs"], ["bunker", "Bunker"], ["loaddisch", "Load-Disch"], ["suez", "Suez Canal"]] as [Tab, string][]).map(([t, l]) => (
            <button key={t} type="button" className={`voy-tab${tab === t ? " is-on" : ""}`} onClick={() => setTab(t)}>{l}</button>
          ))}
        </div>

        <div className="voy-body">
          {tab === "pda" && (
            <>
              <NumInput label="Port days" value={days} onChange={setDays} suffix="d" />
              <NumInput label="Quantity" value={qty} onChange={setQty} suffix="MT" />
              <div className="voy-line"><span>Berth + dues + agency</span><b>{usd(pda.usdExcl)}</b></div>
              <p className="voy-note">KAP-model port DA (SAR→USD @ {pda.rate}); excludes stevedoring unless owner&apos;s account.</p>
            </>
          )}
          {tab === "bunker" && (
            <>
              <NumInput label="Sea days" value={seaDays} onChange={setSeaDays} suffix="d" />
              <div className="voy-line"><span>VLSFO @ ${FUEL_PRICES.vlsfo}/MT</span><b>{usd(bunkerVlsfo)}</b></div>
              <p className="voy-note">Bunker @ first current ticker sponsor · {FUEL_PRICES.port} · {FUEL_PRICES.updated}.</p>
            </>
          )}
          {tab === "loaddisch" && (
            <>
              <NumInput label="Quantity" value={qty} onChange={setQty} suffix="MT" />
              <div className="voy-line"><span>Stevedoring (owner a/c)</span><b>{usd(loadDischUsd)}</b></div>
              <p className="voy-note">Shown when stevedoring is on the owner&apos;s account; otherwise charterer&apos;s cost.</p>
            </>
          )}
          {tab === "suez" && (
            <>
              <NumInput label="SCNRT" value={scnrt} onChange={setScnrt} suffix="t" />
              <label className="voy-field"><span>Status</span>
                <span className="voy-field__in">
                  <select value={laden ? "Laden" : "Ballast"} onChange={(e) => setLaden(e.target.value === "Laden")}>
                    <option>Laden</option><option>Ballast</option>
                  </select>
                </span>
              </label>
              <div className="voy-line"><span>Canal toll + fixed</span><b>{usd(suez.total)}</b></div>
              <p className="voy-note">RUBATO transit model · toll = SCNRT × tariff × SDR, plus fixed dues.</p>
            </>
          )}
        </div>

        <div className="voy-total">
          <span>Estimated OPEX</span>
          <b>{usd(total)}</b>
        </div>
      </div>
    </div>
  );
}
