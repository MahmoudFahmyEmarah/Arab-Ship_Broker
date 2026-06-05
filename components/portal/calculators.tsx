"use client";

// Economic Calculators — Voyage Estimator, Ports DA, Suez Toll. Ported from the
// design (asb/voyage-estimator.jsx) with real formulas (lib/portal/econ.ts) and
// tier gating: locked for T1/T2 (account-derived tier, no UI toggle).
import * as React from "react";
import { CargoView, VesselView } from "@/lib/portal/types";
import { useViewerTier, isCalculatorLocked } from "@/lib/portal/tier";
import {
  FUEL_PRICES,
  SUEZ_FIXED,
  SUEZ_SDR_USD,
  calcVoyage,
  calcPortDA,
  calcSuezToll,
  vesselSCNRT,
  num,
  usd,
} from "@/lib/portal/econ";

// ── Shared chrome ────────────────────────────────────────────────────────────
function EconShell({
  title,
  subtitle,
  actionLabel,
  selector,
  headerAside,
  children,
}: {
  title: string;
  subtitle: string;
  actionLabel: string;
  selector: React.ReactNode;
  headerAside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="econ">
      <div className="econ__head">
        <div>
          <h1 className="page-title">{title}</h1>
          <div className="eyebrow" style={{ marginTop: 2 }}>{subtitle}</div>
        </div>
        <div className="row" style={{ gap: 10 }}>
          {headerAside}
          <button className="asb-btn primary">{actionLabel}</button>
        </div>
      </div>
      <div className="econ__selector">{selector}</div>
      <div className="econ__body">{children}</div>
    </div>
  );
}

function VEDropdown({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="econ-field">
      <label className="econ-field__label">{label}</label>
      <select className="asb-input" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

function Locked({ title }: { title: string }) {
  return (
    <div className="econ-locked">
      <div className="econ-locked__icon">🔒</div>
      <div className="econ-locked__title">{title}</div>
      <div className="econ-locked__features">
        Voyage cost estimate · Port disbursements · Suez Canal toll
      </div>
      <div className="econ-locked__note">Available from Subscriber tier (T3+)</div>
      <button className="asb-btn primary">Upgrade to Subscriber →</button>
    </div>
  );
}

function Row({ k, v, strong, accent }: { k: string; v: React.ReactNode; strong?: boolean; accent?: "blue" | "green" | "red" }) {
  return (
    <div className="econ-row">
      <span className="econ-row__k">{k}</span>
      <span className={`econ-row__v${strong ? " is-strong" : ""}${accent ? ` is-${accent}` : ""}`}>{v}</span>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="econ-card">
      <div className="econ-card__head">{title}</div>
      <div className="econ-card__body">{children}</div>
    </div>
  );
}

// ── Voyage Estimator ─────────────────────────────────────────────────────────
export function VoyageEstimator({ vessels, cargos }: { vessels: VesselView[]; cargos: CargoView[] }) {
  const tier = useViewerTier();
  const [vesselId, setVesselId] = React.useState(vessels[0]?.id ?? "");
  const [cargoId, setCargoId] = React.useState(cargos[0]?.id ?? "");
  if (isCalculatorLocked(tier)) return <Locked title="Voyage Cost Estimator" />;

  const vessel = vessels.find((v) => v.id === vesselId) ?? null;
  const cargo = cargos.find((c) => c.id === cargoId) ?? null;
  const calc = vessel && cargo ? calcVoyage(vessel, cargo) : null;

  const headerAside = (
    <div className="econ-fuel">
      <span className="econ-fuel__pill is-vlsfo">VLSFO ${FUEL_PRICES.vlsfo}/MT</span>
      <span className="econ-fuel__pill is-lsmgo">LSMGO ${FUEL_PRICES.lsmgo}/MT</span>
      <span className="econ-fuel__live"><span className="econ-fuel__dot" /> Live</span>
    </div>
  );

  const selector = (
    <>
      <VEDropdown label="Vessel" value={vesselId} onChange={setVesselId} options={vessels.map((v) => ({ value: v.id, label: `${v.name} · IMO ${v.imo}` }))} />
      <VEDropdown label="Cargo" value={cargoId} onChange={setCargoId} options={cargos.map((c) => ({ value: c.id, label: `${c.refId} · ${c.commodity} · ${c.route.polCode}→${c.route.podCode}` }))} />
    </>
  );

  return (
    <EconShell title="Voyage Cost Estimator" subtitle="Complete voyage P&L" actionLabel="Export estimate" selector={selector} headerAside={headerAside}>
      {!calc ? (
        <div className="econ-empty">Select a vessel and a cargo to calculate.</div>
      ) : (
        <div className="econ-grid">
          <Card title="Voyage legs">
            <table className="econ-table">
              <thead>
                <tr><th>Leg</th><th>Route</th><th>NM</th><th>Days</th><th>VLSFO</th><th>LSMGO</th></tr>
              </thead>
              <tbody>
                {calc.legs.map((l) => (
                  <tr key={l.name}>
                    <td>{l.name}</td>
                    <td className="econ-muted">{l.from}{l.to !== "—" ? ` → ${l.to}` : ""}</td>
                    <td>{l.nm != null ? l.nm.toLocaleString() : "—"}</td>
                    <td>{l.days.toFixed(1)}</td>
                    <td>{l.vlsfo ? Math.round(l.vlsfo) : "—"}</td>
                    <td>{l.lsmgo ? l.lsmgo.toFixed(1) : "—"}</td>
                  </tr>
                ))}
                <tr className="econ-table__total">
                  <td colSpan={2}>Total</td>
                  <td>{calc.totals.nm.toLocaleString()}</td>
                  <td>{calc.totals.days.toFixed(1)}</td>
                  <td>{Math.round(calc.totals.vlsfo)}</td>
                  <td>{calc.totals.lsmgo.toFixed(1)}</td>
                </tr>
              </tbody>
            </table>
          </Card>

          <Card title="Cost summary">
            <Row k="Bunkers (VLSFO + LSMGO)" v={`$${usd(calc.costs.bunker)}`} />
            <Row k="Load port DA" v={`$${usd(calc.costs.polPDA)}`} />
            <Row k="Disch port DA" v={`$${usd(calc.costs.podPDA)}`} />
            <Row k="Suez Canal" v={calc.suez.required ? `$${usd(calc.costs.suezTotal)}` : "Not required"} />
            <Row k="Gross expenses" v={`$${usd(calc.costs.grossExpenses)}`} strong />
          </Card>

          <Card title="Revenue & result">
            <Row k="Gross freight" v={`$${usd(calc.costs.grossFreight)}`} />
            <Row k="Commission" v={`– $${usd(calc.costs.commissionAmt)}`} />
            <Row k="Net freight" v={`$${usd(calc.costs.netFreight)}`} />
            <Row k="Voyage days" v={calc.totals.days.toFixed(1)} />
            <div className="econ-tce">
              <span className="econ-tce__k">Time Charter Equivalent</span>
              <span className={`econ-tce__v ${calc.costs.tce >= 0 ? "is-pos" : "is-neg"}`}>
                ${usd(calc.costs.tce)}/day
              </span>
            </div>
          </Card>
        </div>
      )}
    </EconShell>
  );
}

// ── Ports DA ─────────────────────────────────────────────────────────────────
export function PortsDA({ vessels }: { vessels: VesselView[] }) {
  const tier = useViewerTier();
  const [vesselId, setVesselId] = React.useState(vessels[0]?.id ?? "");
  const [days, setDays] = React.useState(3);
  const [qty, setQty] = React.useState(5000);
  const [stevAcct, setStevAcct] = React.useState("Charterer");
  if (isCalculatorLocked(tier)) return <Locked title="Ports DA Calculator" />;

  const pda = calcPortDA({ days, qtyMT: qty, stevedoringAccount: stevAcct });
  const selector = (
    <VEDropdown label="Vessel" value={vesselId} onChange={setVesselId} options={vessels.map((v) => ({ value: v.id, label: `${v.name} · IMO ${v.imo}` }))} />
  );

  return (
    <EconShell title="Ports DA Calculator" subtitle="Proforma port disbursement estimate" actionLabel="Export DA" selector={selector}>
      <div className="econ-grid">
        <Card title="Inputs">
          <div className="econ-field"><label className="econ-field__label">Berth days</label><input className="asb-input" type="number" value={days} onChange={(e) => setDays(Math.max(1, +e.target.value || 1))} /></div>
          <div className="econ-field"><label className="econ-field__label">Quantity (MT)</label><input className="asb-input" type="number" value={qty} onChange={(e) => setQty(+e.target.value || 0)} /></div>
          <div className="econ-field"><label className="econ-field__label">Stevedoring account</label>
            <select className="asb-input" value={stevAcct} onChange={(e) => setStevAcct(e.target.value)}><option>Charterer</option><option>Owner</option></select>
          </div>
        </Card>
        <Card title="Disbursement breakdown (SAR)">
          <Row k="Berth hire" v={pda.berthHire.toLocaleString()} />
          <Row k="Port dues" v={pda.portDues.toLocaleString()} />
          <Row k="Mooring / unmooring" v={pda.mooring.toLocaleString()} />
          <Row k="Waste reception" v={pda.waste.toLocaleString()} />
          <Row k="TABDUL (incl. VAT)" v={pda.tabdul.toLocaleString()} />
          <Row k="Agency fee" v={pda.agency.toLocaleString()} />
          {pda.stevedoring > 0 && <Row k="Stevedoring (Owner)" v={pda.stevedoring.toLocaleString()} />}
          <Row k="Subtotal (SAR)" v={Math.round(pda.subtotalIncl).toLocaleString()} strong />
        </Card>
        <Card title="Total (USD)">
          <Row k="Excl. stevedoring" v={`$${usd(pda.usdExcl)}`} />
          <Row k="Incl. stevedoring" v={`$${usd(pda.usdIncl)}`} />
          <div className="econ-tce">
            <span className="econ-tce__k">Estimated DA</span>
            <span className="econ-tce__v is-pos">${usd(pda.usdIncl)}</span>
          </div>
          <div className="econ-muted" style={{ marginTop: 6, fontSize: 10 }}>SAR/USD pegged at {pda.rate}</div>
        </Card>
      </div>
    </EconShell>
  );
}

// ── Suez Toll ────────────────────────────────────────────────────────────────
export function SuezToll({ vessels }: { vessels: VesselView[] }) {
  const tier = useViewerTier();
  const [vesselId, setVesselId] = React.useState(vessels[0]?.id ?? "");
  const [status, setStatus] = React.useState("Laden");
  if (isCalculatorLocked(tier)) return <Locked title="Suez Canal Toll" />;

  const vessel = vessels.find((v) => v.id === vesselId) ?? null;
  const scnrt = vessel ? vesselSCNRT(vessel) : 0;
  const suez = calcSuezToll({ scnrt, cargoStatus: status, sdrUsd: SUEZ_SDR_USD });
  const selector = (
    <VEDropdown label="Vessel" value={vesselId} onChange={setVesselId} options={vessels.map((v) => ({ value: v.id, label: `${v.name} · IMO ${v.imo}` }))} />
  );

  return (
    <EconShell title="Suez Canal Toll" subtitle="Proforma transit toll estimate" actionLabel="Export estimate" selector={selector}>
      <div className="econ-grid">
        <Card title="Transit">
          <div className="econ-field"><label className="econ-field__label">Cargo status</label>
            <select className="asb-input" value={status} onChange={(e) => setStatus(e.target.value)}><option>Laden</option><option>Ballast</option></select>
          </div>
          <Row k="SCNRT (est.)" v={scnrt.toLocaleString()} />
          <Row k="Tariff (SDR/SCNRT)" v={suez.tariff.toFixed(3)} />
          <Row k="SDR → USD" v={SUEZ_SDR_USD.toFixed(2)} />
        </Card>
        <Card title="Fixed dues (USD)">
          {SUEZ_FIXED.map(([k, v]) => <Row key={k} k={k} v={`$${v.toLocaleString()}`} />)}
          <Row k="Fixed total" v={`$${usd(suez.fixedTotal)}`} strong />
        </Card>
        <Card title="Total toll (USD)">
          <Row k="Variable toll" v={`$${usd(suez.toll)}`} />
          <Row k="Fixed dues" v={`$${usd(suez.fixedTotal)}`} />
          <div className="econ-tce">
            <span className="econ-tce__k">Total Suez cost</span>
            <span className="econ-tce__v is-pos">${usd(suez.total)}</span>
          </div>
        </Card>
      </div>
    </EconShell>
  );
}
