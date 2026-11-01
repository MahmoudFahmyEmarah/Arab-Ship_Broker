"use client";

// The design's Quick DA (owner B2ALL-061, build step 11): pick one of your cargoes and one of your vessels, see the
// two calls the estimate will price, and open the PDA Estimator with them. Nothing is priced here: the estimator is
// the only place figures come from, so this hands over exactly what it needs (?from=quick…) and nothing else.
import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import type { PdaEstimatorCargoOption, PdaEstimatorVesselOption } from "@/lib/pda/estimator-contract";

export function PdaQuickDa({ cargos, vessels, catalogUnavailable = false, tariffHeld }: {
  cargos: PdaEstimatorCargoOption[]; vessels: PdaEstimatorVesselOption[]; catalogUnavailable?: boolean; tariffHeld: readonly string[];
}) {
  const [cargoId, setCargoId] = React.useState(cargos[0]?.id ?? "");
  const [vesselId, setVesselId] = React.useState(vessels[0]?.id ?? "");
  const cargo = cargos.find((c) => c.id === cargoId) ?? null;
  const vessel = vessels.find((v) => v.id === vesselId) ?? null;
  const [mt, setMt] = React.useState<string>(cargo?.quantityMaxMt != null ? String(cargo.quantityMaxMt) : "");
  React.useEffect(() => { setMt(cargo?.quantityMaxMt != null ? String(cargo.quantityMaxMt) : ""); }, [cargo]);
  const held = new Set(tariffHeld);
  const legs = [
    { role: "POL · load", port: cargo?.loadPort ?? null, cls: "is-pol" },
    { role: "POD · discharge", port: cargo?.dischargePort ?? null, cls: "is-pod" },
  ];
  const params = new URLSearchParams({ from: "quick" });
  if (cargo) params.set("cargoId", cargo.id);
  if (vessel) params.set("vesselId", vessel.id);
  if (cargo?.loadPort.locode) params.set("load", cargo.loadPort.locode);
  if (cargo?.dischargePort.locode) params.set("disch", cargo.dischargePort.locode);
  if (/^\d{1,9}$/.test(mt)) params.set("mt", mt);
  const href = `/dashboard/ports-da?${params.toString()}`;
  return (
    <div className="qd-wrap">
      <div className="qd-bar">
        <label className="qd-f"><span>Cargo</span>
          <div className="qd-sel">
            <select value={cargoId} onChange={(e) => setCargoId(e.target.value)} aria-label="Cargo">
              {cargos.length === 0 ? <option value="">{catalogUnavailable ? "Your listings could not be read" : "No cargo of yours is live"}</option> : cargos.map((c) => <option key={c.id} value={c.id}>{c.cargo} · {c.quantityLabel} · {c.loadPort.name} → {c.dischargePort.name}</option>)}
            </select>
          </div>
        </label>
        <label className="qd-f"><span>Vessel</span>
          <div className="qd-sel">
            <select value={vesselId} onChange={(e) => setVesselId(e.target.value)} aria-label="Vessel">
              {vessels.length === 0 ? <option value="">{catalogUnavailable ? "Your listings could not be read" : "No vessel of yours is open"}</option> : vessels.map((v) => <option key={v.id} value={v.id}>{v.name} · {v.type} · {v.dwt} DWT</option>)}
            </select>
          </div>
        </label>
        <label className="qd-f"><span>Quantity (MT)</span>
          <input inputMode="numeric" value={mt} onChange={(e) => setMt(e.target.value.replace(/[^\d]/g, "").slice(0, 9))} aria-label="Quantity in metric tonnes" placeholder={cargo?.quantityLabel ?? "—"} />
        </label>
        {catalogUnavailable
          ? <div className="qd-ctx" role="alert">Your listings could not be read just now, so nothing is offered here; try again in a moment.</div>
          : <div className="qd-ctx">Both records are yours; the estimator re-reads them on open and prices each call from the tariff that governs the port.</div>}
      </div>

      <div className="qd-legs">
        {legs.map((leg) => (
          <div key={leg.role} className={`qd-leg ${leg.cls}`}>
            <div className="qd-leg__role">{leg.role}</div>
            <div className="qd-leg__port">{leg.port?.name ?? "Pick a cargo"}</div>
            <div className="qd-leg__none">
              {!leg.port ? "The cargo supplies the port." : !leg.port.locode ? "This side is an area, not a port: the estimator asks for the reference port." : held.has(leg.port.locode) ? "A published tariff is in force: priced line by line in the estimator." : "No tariff in force: the estimator asks an attending agent for a quote."}
            </div>
          </div>
        ))}
      </div>

      <div className="qd-total">
        <div>
          <span className="qd-total__k">Both calls, priced in the estimator</span>
          <span className="qd-total__sub">{cargo ? `${cargo.loadPort.name} → ${cargo.dischargePort.name}` : "Choose a cargo and a vessel"}{vessel ? ` · ${vessel.name}` : ""}</span>
        </div>
        {cargo && vessel ? <Link className="qd-cta" href={href}>Open in the PDA Estimator <ChevronRight size={14} aria-hidden="true" /></Link> : <span className="qd-cta is-off" aria-disabled="true">Open in the PDA Estimator</span>}
      </div>
      <div className="qd-foot">No figure is shown here on purpose: a DA is only ever priced in the estimator, from a published tariff or a quote, and says where every line came from.</div>
    </div>
  );
}
