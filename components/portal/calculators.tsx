"use client";

// Economic Calculators — Voyage Cost Estimator · Ports DA · Suez Canal Toll.
// Faithful port of the approved prototype (asb/voyage-estimator.jsx) onto real
// data (lib/portal/econ.ts models, live admin fuel prices) with T3+ tier
// gating. The three pages share ONE calculation source: the estimator's POL PDA
// comes from calcPortDA and its Suez line from calcSuezToll — identical to
// opening those pages directly.
import * as React from "react";
import Link from "next/link";
import { CargoView, VesselView } from "@/lib/portal/types";
import { useViewerTier, isCalculatorLocked } from "@/lib/portal/tier";
import { BunkerTicker } from "./BunkerTicker";
import {
  SUEZ_FIXED,
  SUEZ_SDR_USD,
  calcVoyage,
  calcPortDA,
  calcSuezToll,
  vesselGT,
  vesselSCNRT,
  scnrtIsEstimated,
  type FuelPrices,
} from "@/lib/portal/econ";
import "@/lib/portal/voyage-estimator.css";

const KAP_SAR_USD = 3.75;

// ── Formatters ───────────────────────────────────────────────────────────────
const fmtUSD = (n: number) => "$" + Math.round(n || 0).toLocaleString();
const fmtUSD2 = (n: number) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtSAR = (n: number) => "SAR " + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtNM = (n: number | null) => (n == null ? "—" : Math.round(n).toLocaleString());
const fmtDays = (n: number | null) => (n == null ? "—" : n.toFixed(1));
const fmtMT = (n: number | null) => (n == null ? "—" : n.toFixed(1));

// ── CountUp — animates a numeric headline (easeOutCubic ~750ms) ──────────────
function CountUp({ value, format, duration = 750 }: { value: number; format: (n: number) => string; duration?: number }) {
  const v = Number(value) || 0;
  const [disp, setDisp] = React.useState(v);
  const fromRef = React.useRef(v);
  const rafRef = React.useRef<number | null>(null);
  React.useEffect(() => {
    const from = fromRef.current;
    const to = v;
    if (Math.abs(to - from) < 0.005) { setDisp(to); fromRef.current = to; return; }
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisp(from + (to - from) * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(step);
      else fromRef.current = to;
    };
    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [v, duration]);
  return <>{format(disp)}</>;
}

// ── Shared chrome ────────────────────────────────────────────────────────────
function EconShell({
  title, subtitle, actionLabel, selector, headerAside, children,
}: {
  title: string; subtitle: string; actionLabel: string;
  selector: React.ReactNode; headerAside?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="ve-page">
      <div className="ve-shell">
        <BunkerTicker />
        <div className="ve-head">
          <div className="ve-head__row">
            <div>
              <div className="ve-head__title">{title}</div>
              <div className="ve-head__sub">{subtitle}</div>
            </div>
            <div className="ve-head-right">
              {headerAside}
              <button className="ve-btn" type="button">{actionLabel}</button>
            </div>
          </div>
        </div>
        {selector}
        <div className="ve-content">{children}</div>
      </div>
    </div>
  );
}

function VEDropdown({ label, value, onChange, options, cls = "" }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; cls?: string }) {
  return (
    <div className={`ve-selector__field ${cls}`}>
      <label className="ve-selector__label">{label}</label>
      <div className="ve-selector__control">
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <span className="ve-selector__caret">▾</span>
      </div>
    </div>
  );
}

function VEField({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="ve-field"><label className="ve-field__label">{label}</label>{children}</div>;
}

function InfoCard({ title, kvs }: { title: string; kvs: [string, React.ReactNode, { amber?: boolean; editable?: boolean }?][] }) {
  return (
    <div className="ve-info-card">
      <div className="ve-info-card__head">{title}</div>
      <div className="ve-info-card__body">
        {kvs.map(([k, v, opts], i) => (
          <div key={i} className="ve-info-card__row">
            <span className="ve-info-card__k">{k}</span>
            <span className={`ve-info-card__v${opts?.amber ? " is-amber" : opts?.editable ? " is-editable" : " is-auto"}`}>
              {v}{opts?.amber && <span className="ve-warn">  ⚠ Not declared</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CalculatorLocked({ title }: { title: string }) {
  return <Locked title={title} />;
}

function Locked({ title }: { title: string }) {
  return (
    <div className="ve-page">
      <div className="ve-shell">
        <div className="estimator-locked">
          <div className="locked-icon">🔒</div>
          <div className="locked-title">{title}</div>
          <div className="locked-features">Voyage cost estimate · Port disbursements<br />Suez Canal toll</div>
          <div className="locked-tier-note">Available from Subscriber tier (T3+)</div>
          <Link href="/dashboard/account?tab=billing" className="locked-upgrade-btn">Upgrade to Subscriber →</Link>
        </div>
      </div>
    </div>
  );
}

const vesselOpts = (vessels: VesselView[]) => vessels.map((v) => ({ value: v.id, label: `${v.name} · IMO ${v.imo}` }));

// ════════════════════════════════════════════════════════════════════════════
// PAGE 1 — Voyage Cost Estimator
// ════════════════════════════════════════════════════════════════════════════
export function VoyageEstimator({ vessels, cargos, fuel, initialVesselId, initialCargoId }: { vessels: VesselView[]; cargos: CargoView[]; fuel: FuelPrices; initialVesselId?: string; initialCargoId?: string }) {
  const tier = useViewerTier();
  const [vesselId, setVesselId] = React.useState(initialVesselId || vessels[0]?.id || "");
  const [cargoId, setCargoId] = React.useState(initialCargoId || cargos[0]?.id || "");
  if (isCalculatorLocked(tier)) return <Locked title="Voyage Cost Estimator" />;

  const vessel = vessels.find((v) => v.id === vesselId) ?? null;
  const cargo = cargos.find((c) => c.id === cargoId) ?? null;
  const calc = vessel && cargo ? calcVoyage(vessel, cargo, { fuel }) : null;

  const headerAside = (
    <div className="ve-head-fuel" title="Prices match the bunker ticker and feed this voyage's bunker cost.">
      <span className="ve-fuel-pill is-vlsfo">VLSFO ${fuel.vlsfo}/MT</span>
      <span className="ve-fuel-pill is-lsmgo">LSMGO ${fuel.lsmgo}/MT</span>
      <span className="ve-fuel-live"><span className="ve-fuel-live__dot" /> Live</span>
      {fuel.updated && <span className="ve-head-fuel__meta">{fuel.port} · upd. {fuel.updated}</span>}
    </div>
  );

  const selector = (
    <div className="ve-selector ve-selector--two">
      <VEDropdown label="Vessel" value={vesselId} onChange={setVesselId} options={vesselOpts(vessels)} />
      <VEDropdown label="Cargo" value={cargoId} onChange={setCargoId} options={cargos.map((c) => ({ value: c.id, label: `${c.refId} · ${c.commodity} · ${c.route.polCode}→${c.route.podCode}` }))} />
    </div>
  );

  return (
    <EconShell title="Voyage Cost Estimator" subtitle="Complete voyage P&L" actionLabel="Export estimate" selector={selector} headerAside={headerAside}>
      {!calc || !vessel || !cargo ? (
        <div className="ve-empty">Select a vessel and a cargo to calculate.</div>
      ) : (
        <VoyageBody vessel={vessel} cargo={cargo} calc={calc} fuel={fuel} />
      )}
    </EconShell>
  );
}

function VoyageBody({ vessel: v, cargo: c, calc, fuel }: { vessel: VesselView; cargo: CargoView; calc: NonNullable<ReturnType<typeof calcVoyage>>; fuel: FuelPrices }) {
  const lsmgoSeaAmber = v.fuel.lsmgoSea === "—";
  const lsmgoPortAmber = v.fuel.lsmgoPort === "—";
  const suezApplies = calc.suez.required;
  return (
    <>
      <div className="ve-upper">
        <InfoCard title={`Vessel · from registration`} kvs={[
          ["Vessel name", v.name],
          ["Type / Flag", `${v.type} · ${v.flag}`],
          ["DWT (MT)", v.dwt],
          ["Speed laden (kn)", calc.speed.laden],
          ["Speed ballast (kn)", calc.speed.ballast],
          ["VLSFO sea (MT/day)", v.fuel.vlsfoSea],
          ["LSMGO sea (MT/day)", lsmgoSeaAmber ? "Not declared" : v.fuel.lsmgoSea, { amber: lsmgoSeaAmber }],
          ["LSMGO port (MT/day)", lsmgoPortAmber ? "Not declared" : v.fuel.lsmgoPort, { amber: lsmgoPortAmber }],
        ]} />
        <InfoCard title={`Cargo · from listing · ${c.refId}`} kvs={[
          ["Cargo", c.commodity],
          ["Quantity (MT)", c.qtyMt],
          ["Freight rate ($/MT)", `$${c.freightIdea ?? "—"}`, { editable: true }],
          ["Commission (%)", `${c.commission ?? 0}%`],
          ["Load rate (MT/day)", c.loadRate ? Number(c.loadRate).toLocaleString() : "—"],
          ["Discharge rate (MT/day)", c.dischRate ? Number(c.dischRate).toLocaleString() : "—"],
          ["Loading days (auto)", fmtDays(calc.ports.polDays)],
          ["Discharging days (auto)", fmtDays(calc.ports.podDays)],
        ]} />
        <div className="ve-legs">
          <table className="ve-table">
            <thead>
              <tr>
                <th style={{ width: 104 }}>Leg</th><th>From → To</th>
                <th style={{ width: 58, textAlign: "right" }}>NM</th>
                <th style={{ width: 50, textAlign: "right" }}>Days</th>
                <th style={{ width: 70, textAlign: "right" }}>VLSFO</th>
                <th style={{ width: 70, textAlign: "right" }}>LSMGO</th>
              </tr>
            </thead>
            <tbody>
              {calc.legs.map((leg, i) => {
                const disabled = leg.name === "Suez transit" && !leg.suez;
                return (
                  <tr key={i} className={disabled ? "is-disabled" : ""}>
                    <td><strong>{i + 1}</strong> · {leg.name}</td>
                    <td>{leg.from}{leg.to !== "—" ? <span style={{ color: "var(--asb-gray-500)" }}> → {leg.to}</span> : ""}</td>
                    <td style={{ textAlign: "right" }} className={leg.nm != null && !leg.nmAuto ? "is-editable" : leg.nm != null ? "is-auto" : ""}>{fmtNM(leg.nm)}</td>
                    <td style={{ textAlign: "right" }} className="is-auto">{fmtDays(leg.days)}</td>
                    <td style={{ textAlign: "right" }} className="is-auto">{leg.vlsfo ? fmtMT(leg.vlsfo) : "—"}</td>
                    <td style={{ textAlign: "right" }} className="is-auto">{leg.lsmgo ? fmtMT(leg.lsmgo) : "—"}</td>
                  </tr>
                );
              })}
              <tr className="ve-table__total">
                <td colSpan={2}><strong>Totals</strong></td>
                <td style={{ textAlign: "right" }}><strong>{fmtNM(calc.totals.nm)}</strong></td>
                <td style={{ textAlign: "right" }}><strong>{fmtDays(calc.totals.days)}</strong></td>
                <td style={{ textAlign: "right" }}><strong>{fmtMT(calc.totals.vlsfo)}</strong></td>
                <td style={{ textAlign: "right" }}><strong>{fmtMT(calc.totals.lsmgo)}</strong></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="ve-legend">
        <span style={{ color: "var(--asb-green)" }}>Green</span> = auto-retrieved from the database ·{" "}
        <span style={{ color: "var(--asb-blue)" }}>blue</span> = editable for this estimate ·{" "}
        <span style={{ color: "var(--asb-amber)" }}>amber</span> = manual / not declared. All figures feed the map overlay and card tooltips from one calc.
      </div>

      <div className="ve-pl-grid">
        <div className="ve-pl-card">
          <div className="ve-pl-card__title">Voyage Expenses</div>
          <div className="ve-pl-section">Bunker costs</div>
          <div className="ve-pl-row"><span>VLSFO</span><span className="is-auto">{fmtMT(calc.totals.vlsfo)} MT × ${fuel.vlsfo} = {fmtUSD(calc.costs.bunkerVLSFO)}</span></div>
          <div className="ve-pl-row"><span>LSMGO</span><span className="is-auto">{fmtMT(calc.totals.lsmgo)} MT × ${fuel.lsmgo} = {fmtUSD(calc.costs.bunkerLSMGO)}</span></div>
          <div className="ve-pl-row is-subtotal"><span>Total bunker cost</span><span>{fmtUSD(calc.costs.bunker)}</span></div>

          <div className="ve-pl-section">Port disbursements</div>
          <div className="ve-pl-row ve-pl-row--linked">
            <span>POL PDA · {c.route.polName}<small className="ve-linked-src">from Ports DA Calculator</small></span>
            <span className="is-auto">{fmtUSD(calc.costs.polPDA)}</span>
          </div>
          <div className="ve-pl-row"><span>POD PDA · {c.route.podName}</span><span className="is-amber">{fmtUSD(calc.costs.podPDA)} ⚠ Manual</span></div>
          <div className="ve-pl-row ve-pl-row--linked">
            <span>Suez Canal transit{suezApplies && <small className="ve-linked-src">from Suez Canal Toll</small>}</span>
            <span className={suezApplies ? "is-auto" : "is-muted"}>{suezApplies ? fmtUSD(calc.costs.suezTotal) : "Not applicable"}</span>
          </div>

          <div className="ve-pl-section">Other</div>
          <div className="ve-pl-row"><span>Insurance / war risk</span><span className="is-editable">{fmtUSD(calc.costs.insurance)}</span></div>
          <div className="ve-pl-row"><span>Stevedoring</span><span className="is-editable">{fmtUSD(calc.costs.stevedoring)}</span></div>

          <div className="ve-pl-row is-grand"><span>GROSS VOYAGE EXPENSES</span><span><CountUp value={calc.costs.grossExpenses} format={fmtUSD} /></span></div>
        </div>

        <div className="ve-pl-card">
          <div className="ve-pl-card__title">Revenue</div>
          <div className="ve-pl-row"><span>Cargo qty × Freight rate</span><span className="is-auto">{c.qtyMt} MT × ${c.freightIdea ?? 0} = {fmtUSD(calc.costs.grossFreight)}</span></div>
          <div className="ve-pl-row"><span>Less: commission ({c.commission ?? 0}%)</span><span className="is-auto">−{fmtUSD(calc.costs.commissionAmt)}</span></div>
          <div className="ve-pl-row is-grand"><span>NET FREIGHT</span><span><CountUp value={calc.costs.netFreight} format={fmtUSD} /></span></div>

          <div className="ve-spacer" />
          <div className="ve-pl-section">Quick analysis</div>
          <div className="ve-pl-row"><span>Net per voyage day</span><span className="is-auto">{fmtUSD(calc.costs.netFreight / Math.max(calc.totals.days, 0.1))}</span></div>
          <div className="ve-pl-row"><span>Bunker share of expenses</span><span className="is-auto">{((calc.costs.bunker / Math.max(calc.costs.grossExpenses, 1)) * 100).toFixed(0)}%</span></div>
          <div className="ve-pl-row"><span>PDA share of expenses</span><span className="is-auto">{(((calc.costs.polPDA + calc.costs.podPDA) / Math.max(calc.costs.grossExpenses, 1)) * 100).toFixed(0)}%</span></div>
        </div>
      </div>

      <div className="ve-results">
        <div className="ve-result"><div className="ve-result__k">Total voyage days</div><div className="ve-result__v ve-result__v--navy"><CountUp value={calc.totals.days} format={fmtDays} /></div></div>
        <div className="ve-result"><div className="ve-result__k">Total bunker cost</div><div className="ve-result__v ve-result__v--amber"><CountUp value={calc.costs.bunker} format={fmtUSD} /></div></div>
        <div className="ve-result"><div className="ve-result__k">Gross freight</div><div className="ve-result__v ve-result__v--green"><CountUp value={calc.costs.grossFreight} format={fmtUSD} /></div></div>
        <div className="ve-result ve-result--tce"><div className="ve-result__k">TCE estimate</div><div className="ve-result__v"><CountUp value={calc.costs.tce} format={fmtUSD} /><span className="ve-result__unit">/day</span></div></div>
      </div>

      <div className="ve-data-bar">🔗 These figures match the voyage-economics overlay on the map and the card tooltips — all read from the same calculation.</div>
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// PAGE 2 — Ports DA Calculator (King Abdullah Port / Kanoo proforma)
// ════════════════════════════════════════════════════════════════════════════
export function PortsDA({ vessels, cargos }: { vessels: VesselView[]; cargos: CargoView[] }) {
  const tier = useViewerTier();
  const ports = React.useMemo(() => {
    const m = new Map<string, string>();
    m.set("King Abdullah Port", "SAKAC");
    cargos.forEach((c) => { if (c.route.polName) m.set(c.route.polName, c.route.polCode); if (c.route.podName) m.set(c.route.podName, c.route.podCode); });
    return [...m.entries()].map(([name, code]) => ({ name, code }));
  }, [cargos]);

  const [vesselId, setVesselId] = React.useState(vessels[0]?.id || "");
  const [portCode, setPortCode] = React.useState("SAKAC");
  const [days, setDays] = React.useState(3);
  const [qty, setQty] = React.useState(5000);
  const [agent, setAgent] = React.useState("Kanoo Shipping, King Abdullah Port");
  const [stevAcct, setStevAcct] = React.useState("Charterer");
  if (isCalculatorLocked(tier)) return <Locked title="Ports DA Calculator" />;

  const vessel = vessels.find((v) => v.id === vesselId) ?? null;
  const port = ports.find((p) => p.code === portCode) ?? ports[0];
  const isKAP = portCode === "SAKAC";
  const pda = calcPortDA({ days, qtyMT: qty, stevedoringAccount: stevAcct });
  const usd = (sar: number) => sar / KAP_SAR_USD;
  const owner = stevAcct === "Owner";

  const selector = (
    <div className="ve-selector ve-selector--two">
      <VEDropdown label="Vessel" value={vesselId} onChange={setVesselId} options={vesselOpts(vessels)} />
      <VEDropdown label="Port of call" value={portCode} onChange={setPortCode} options={ports.map((p) => ({ value: p.code, label: `${p.name} · ${p.code}` }))} />
    </div>
  );

  return (
    <EconShell title="Ports DA Calculator" subtitle="Proforma port disbursement estimate" actionLabel="Export DA" selector={selector}>
      {!vessel ? <div className="ve-empty">Select a vessel to calculate.</div> : (
        <div className="ve-calc">
          {!isKAP && (
            <div className="ve-note-line" style={{ background: "var(--asb-amber-bg)", border: "0.5px solid var(--asb-amber)", color: "var(--asb-amber)", padding: "8px 12px", borderRadius: 6 }}>
              ⚠ Phase-1 limitation: only the King Abdullah Port rate card is loaded. Figures below apply the KAP/Kanoo proforma — confirm {port.name}&apos;s own tariff with the agent.
            </div>
          )}
          <div className="ve-input-grid">
            <div className="ve-input-card">
              <div className="ve-input-card__head">Vessel details · from profile</div>
              <div className="ve-input-card__body">
                <div className="ve-kv"><span>Vessel name</span><span className="is-auto">{vessel.name}</span></div>
                <div className="ve-kv"><span>IMO</span><span className="is-auto">{vessel.imo}</span></div>
                <div className="ve-kv"><span>DWT (MT)</span><span className="is-auto">{vessel.dwt}</span></div>
                <div className="ve-kv"><span>GT{vessel.gt == null ? " (est.)" : ""}</span><span className="is-auto">{vesselGT(vessel).toLocaleString()}</span></div>
                {vessel.loaM != null && <div className="ve-kv"><span>LOA</span><span className="is-auto">{vessel.loaM} m</span></div>}
              </div>
            </div>
            <div className="ve-input-card">
              <div className="ve-input-card__head">Port &amp; voyage details</div>
              <div className="ve-input-card__body">
                <VEField label="Port of call"><input className="ve-inp" value={port.name} readOnly /></VEField>
                <VEField label="Attending agent"><input className="ve-inp" value={agent} onChange={(e) => setAgent(e.target.value)} /></VEField>
                <div className="ve-field-row">
                  <VEField label="Est. days in port"><input className="ve-inp ve-inp--num" type="number" min={1} value={days} onChange={(e) => setDays(Math.max(1, parseInt(e.target.value) || 1))} /></VEField>
                  <VEField label="Cargo quantity (MT)"><input className="ve-inp ve-inp--num" type="number" min={0} value={qty} onChange={(e) => setQty(Math.max(0, parseInt(e.target.value) || 0))} /></VEField>
                </div>
                <VEField label="Stevedoring account">
                  <div className="ve-seg ve-seg--sm">
                    {["Owner", "Charterer", "Receiver"].map((o) => <button key={o} type="button" className={`ve-seg__btn${stevAcct === o ? " is-active" : ""}`} onClick={() => setStevAcct(o)}>{o}</button>)}
                  </div>
                </VEField>
                <div className="ve-kv"><span>SAR to USD rate</span><span className="is-auto">{KAP_SAR_USD.toFixed(2)} (auto)</span></div>
              </div>
            </div>
          </div>

          <table className="ve-li-table">
            <thead><tr><th>Description</th><th>Basis</th><th className="num">Amount SAR</th><th className="num">Amount USD</th><th className="notes">Notes</th></tr></thead>
            <tbody>
              <tr><td>Berth hire</td><td>Day 1–3 SAR 2,100/day, Day 4+ SAR 3,000/day</td><td className="num">{fmtSAR(pda.berthHire)}</td><td className="num">{fmtUSD2(usd(pda.berthHire))}</td><td className="notes">{pda.days} day(s) in port</td></tr>
              <tr><td>Port dues</td><td>Per call</td><td className="num">{fmtSAR(pda.portDues)}</td><td className="num">{fmtUSD2(usd(pda.portDues))}</td><td className="notes">Flat SAR 2,400 per call</td></tr>
              <tr><td>Mooring &amp; unmooring</td><td>Per call</td><td className="num">{fmtSAR(pda.mooring)}</td><td className="num">{fmtUSD2(usd(pda.mooring))}</td><td className="notes">Fixed boat service charge</td></tr>
              <tr><td>Waste / garbage</td><td>Per day</td><td className="num">{fmtSAR(pda.waste)}</td><td className="num">{fmtUSD2(usd(pda.waste))}</td><td className="notes">SAR 400/day × {pda.days}</td></tr>
              <tr><td>Tabdul notification</td><td>Per call + VAT</td><td className="num">{fmtSAR(pda.tabdul)}</td><td className="num">{fmtUSD2(usd(pda.tabdul))}</td><td className="notes">SAR 50 + 15% VAT</td></tr>
              <tr><td>Agency fee</td><td>Negotiated</td><td className="num is-editable">{fmtSAR(pda.agency)}</td><td className="num">{fmtUSD2(usd(pda.agency))}</td><td className="notes">Editable lump sum</td></tr>
              <tr className="ve-li-table__sub"><td colSpan={2}><strong>Subtotal · excl. stevedoring</strong></td><td className="num"><strong>{fmtSAR(pda.subtotalExcl)}</strong></td><td className="num"><strong>{fmtUSD2(pda.usdExcl)}</strong></td><td className="notes" /></tr>
              <tr className={owner ? "" : "is-disabled"}><td>Stevedoring</td><td>SAR 8/MT</td><td className="num">{owner ? fmtSAR(pda.stevedoring) : "0.00"}</td><td className="num">{owner ? fmtUSD2(usd(pda.stevedoring)) : "$0.00"}</td><td className="notes">{owner ? `SAR 8 × ${qty.toLocaleString()} MT` : "On charterer / receiver account"}</td></tr>
              <tr className="ve-li-table__total"><td colSpan={2}><strong>Subtotal · incl. stevedoring</strong></td><td className="num"><strong><CountUp value={pda.subtotalIncl} format={fmtSAR} /></strong></td><td className="num"><strong><CountUp value={pda.usdIncl} format={fmtUSD2} /></strong></td><td className="notes" /></tr>
            </tbody>
          </table>
          <div className="ve-note-line">Estimate only. Actual disbursements may vary. The PDA total feeds the Voyage Cost Estimator.</div>
        </div>
      )}
    </EconShell>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// PAGE 3 — Suez Canal Toll (RUBATO transit invoice)
// ════════════════════════════════════════════════════════════════════════════
export function SuezToll({ vessels }: { vessels: VesselView[] }) {
  const tier = useViewerTier();
  const [vesselId, setVesselId] = React.useState(vessels[0]?.id || "");
  const [dir, setDir] = React.useState("Southbound");
  const [status, setStatus] = React.useState("Laden");
  if (isCalculatorLocked(tier)) return <Locked title="Suez Canal Toll" />;

  const vessel = vessels.find((v) => v.id === vesselId) ?? null;
  const scnrt = vessel ? vesselSCNRT(vessel) : 0;
  const suez = calcSuezToll({ scnrt, cargoStatus: status, sdrUsd: SUEZ_SDR_USD });
  const tariff = status === "Ballast" ? 6.515 : 8.687;

  const selector = (
    <div className="ve-selector ve-selector--one">
      <VEDropdown label="Vessel" value={vesselId} onChange={setVesselId} options={vesselOpts(vessels)} />
    </div>
  );

  return (
    <EconShell title="Suez Canal Toll" subtitle="Proforma transit toll estimate" actionLabel="Export estimate" selector={selector}>
      {!vessel ? <div className="ve-empty">Select a vessel to calculate.</div> : (
        <div className="ve-calc">
          <div className="ve-input-grid">
            <div className="ve-input-card">
              <div className="ve-input-card__head">Vessel inputs · from profile</div>
              <div className="ve-input-card__body">
                <div className="ve-kv"><span>Vessel name</span><span className="is-auto">{vessel.name}</span></div>
                <div className="ve-kv"><span>IMO</span><span className="is-auto">{vessel.imo}</span></div>
                <div className="ve-kv"><span>SCNRT{scnrtIsEstimated(vessel) ? " (est.)" : ""}</span><span className="is-auto">{scnrt.toLocaleString()}</span></div>
                <div className="ve-note-sub">SCNRT = Suez Canal Net Registered Tonnage, from the vessel&apos;s Suez Canal certificate.{scnrtIsEstimated(vessel) ? " Estimated from DWT until the certificate value is on file." : ""}</div>
              </div>
            </div>
            <div className="ve-input-card">
              <div className="ve-input-card__head">Transit parameters</div>
              <div className="ve-input-card__body">
                <VEField label="Direction"><div className="ve-seg">{["Southbound", "Northbound"].map((o) => <button key={o} type="button" className={`ve-seg__btn${dir === o ? " is-active" : ""}`} onClick={() => setDir(o)}>{o}</button>)}</div></VEField>
                <VEField label="Cargo status"><div className="ve-seg">{["Laden", "Ballast"].map((o) => <button key={o} type="button" className={`ve-seg__btn${status === o ? " is-active" : ""}`} onClick={() => setStatus(o)}>{o}</button>)}</div></VEField>
                <div className="ve-kv"><span>SDR to USD rate</span><span className="is-auto">{SUEZ_SDR_USD.toFixed(2)} (auto)</span></div>
                <div className="ve-kv"><span>Tariff rate</span><span className="is-auto">{tariff.toFixed(3)} SDR / SCNRT</span></div>
                <div className="ve-note-sub">Auto-selected: Laden 8.687, Ballast 6.515 SDR per SCNRT.</div>
              </div>
            </div>
          </div>

          <table className="ve-li-table">
            <thead><tr><th className="no">No.</th><th>Charge</th><th className="num">Amount USD</th><th className="notes">Notes</th></tr></thead>
            <tbody>
              <tr className="ve-li-table__hl"><td className="no">1</td><td>Suez Canal transit toll</td><td className="num">{fmtUSD2(suez.toll)}</td><td className="notes">{scnrt.toLocaleString()} SCNRT × {tariff.toFixed(3)} × {SUEZ_SDR_USD.toFixed(2)} SDR/USD</td></tr>
              {SUEZ_FIXED.map(([label, amt], i) => <tr key={label}><td className="no">{i + 2}</td><td>{label}</td><td className="num">{fmtUSD2(amt)}</td><td className="notes">Fixed per transit</td></tr>)}
              <tr className="ve-li-table__total"><td className="no" /><td><strong>Total transit cost</strong></td><td className="num"><strong><CountUp value={suez.total} format={fmtUSD2} /></strong></td><td className="notes" /></tr>
            </tbody>
          </table>
          <div className="ve-note-line">Estimate only. Confirm SCNRT and the current SDR rate with the SCA agent before transit. The Suez total feeds the Voyage Cost Estimator only when a transit leg applies.</div>
        </div>
      )}
    </EconShell>
  );
}
