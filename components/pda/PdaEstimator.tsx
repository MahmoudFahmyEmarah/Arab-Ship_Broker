"use client";

import * as React from "react";

import { persistPda, previewPda } from "@/app/(dashboard)/dashboard/ports-da/actions";
import type { PdaCalculationResult, PdaManualLineInput, PdaRequest } from "@/lib/pda/types";
import type { VesselView } from "@/lib/portal/types";
import type { PdaCoverageItem, PdaTerminalItem } from "@/sdk/app/pda";

import "./pda.css";

export interface PdaPortOption { locode: string; name: string; country: string }
interface Props { ports: PdaPortOption[]; coverage: PdaCoverageItem[]; terminals: PdaTerminalItem[]; vessels: VesselView[] }

const SERVICES = ["port_dues", "pilotage", "towage", "mooring", "agency", "waste", "security", "launch"];
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const numberOrNull = (value: string) => {
  if (!value.trim()) return null;
  const parsed = Number(value.replaceAll(",", ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};
const money = (value: number, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);

export function PdaEstimator({ ports, coverage, terminals, vessels }: Props) {
  const initialVessel = vessels[0] ?? null;
  const [portLocode, setPortLocode] = React.useState(coverage[0]?.portLocode ?? ports[0]?.locode ?? "");
  const [terminalId, setTerminalId] = React.useState("");
  const [callDate, setCallDate] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [vesselId, setVesselId] = React.useState(initialVessel?.id ?? "");
  const [gt, setGt] = React.useState(initialVessel?.gt == null ? "" : String(initialVessel.gt));
  const [nt, setNt] = React.useState("");
  const [scnrt, setScnrt] = React.useState("");
  const [dwt, setDwt] = React.useState(initialVessel?.dwt?.replaceAll(",", "") ?? "");
  const [loa, setLoa] = React.useState(initialVessel?.loaM == null ? "" : String(initialVessel.loaM));
  const [draft, setDraft] = React.useState("");
  const [days, setDays] = React.useState("3");
  const [hours, setHours] = React.useState("");
  const [cargoQuantity, setCargoQuantity] = React.useState("");
  const [cargoStatus, setCargoStatus] = React.useState<"laden" | "ballast">("laden");
  const [location, setLocation] = React.useState<"alongside" | "anchorage">("alongside");
  const [services, setServices] = React.useState<string[]>(SERVICES);
  const [convertedCurrency, setConvertedCurrency] = React.useState("");
  const [fxRate, setFxRate] = React.useState("");
  const [manualLines, setManualLines] = React.useState<PdaManualLineInput[]>([]);
  const [result, setResult] = React.useState<PdaCalculationResult | null>(null);
  const [savedId, setSavedId] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<"preview" | "save" | null>(null);
  const [error, setError] = React.useState("");

  const vessel = vessels.find((item) => item.id === vesselId) ?? null;
  const terminalOptions = terminals.filter((item) => item.portLocode === portLocode);
  const covered = coverage.some((item) => item.portLocode === portLocode);

  React.useEffect(() => {
    setResult(null);
    setSavedId(null);
  }, [
    portLocode, terminalId, callDate, vesselId, gt, nt, scnrt, dwt, loa,
    draft, days, hours, cargoQuantity, cargoStatus, location, services,
    convertedCurrency, fxRate, manualLines,
  ]);

  function selectVessel(nextId: string) {
    const nextVessel = vessels.find((item) => item.id === nextId) ?? null;
    setVesselId(nextId);
    setGt(nextVessel?.gt == null ? "" : String(nextVessel.gt));
    setDwt(nextVessel?.dwt?.replaceAll(",", "") ?? "");
    setLoa(nextVessel?.loaM == null ? "" : String(nextVessel.loaM));
  }

  function request(): PdaRequest {
    return {
      portLocode,
      terminalId: terminalId || null,
      callDate,
      vessel: {
        // A market listing handle is deliberately never accepted as a vessel
        // foreign key. Only an exact owner/admin row carries `vesselId`.
        vesselId:
          vessel?.isOwned === true &&
          vessel.canManage === true &&
          vessel.vesselId &&
          isUuid(vessel.vesselId)
            ? vessel.vesselId
            : null,
        vesselName: vessel?.name ?? null,
        imo: vessel?.imo ?? null,
        vesselType: vessel?.type ?? null,
        gt: numberOrNull(gt), nt: numberOrNull(nt), scnrt: numberOrNull(scnrt), dwt: numberOrNull(dwt), loaM: numberOrNull(loa), draftM: numberOrNull(draft),
      },
      call: {
        days: Math.max(.01, numberOrNull(days) ?? 0), hours: numberOrNull(hours), cargoQuantityMt: numberOrNull(cargoQuantity),
        cargoStatus, voyageScope: "international", location, requestedServices: services,
      },
      convertedCurrency: convertedCurrency.trim().toUpperCase() || null,
      fxRate: numberOrNull(fxRate),
      manualLines,
    };
  }

  async function calculate(save: boolean) {
    setBusy(save ? "save" : "preview"); setError("");
    try {
      if (save) {
        const response = await persistPda(request());
        if (!response.ok) throw new Error(response.error);
        setResult(response.data.result);
        setSavedId(response.data.estimateId);
      } else {
        const response = await previewPda(request());
        if (!response.ok) throw new Error(response.error);
        setResult(response.data);
        setSavedId(null);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to calculate PDA"); }
    finally { setBusy(null); }
  }

  function addManualLine(ruleCode?: string) {
    setManualLines((rows) => [...rows, {
      ruleCode: ruleCode ?? null,
      label: ruleCode ? `Manual quote: ${ruleCode.replaceAll("_", " ")}` : "Additional authorized charge",
      amount: 0, reason: "Quoted by appointed port agent", enteredBy: "authenticated user",
    }]);
  }

  return <main className="pda-page">
    <header className="pda-header">
      <div><span className="pda-eyebrow">Economic calculator</span><h1>Port DA Estimator</h1><p>Build an explainable proforma disbursement account from an effective, published port tariff.</p></div>
      <div className="pda-actions">
        <button className="pda-button pda-button--secondary" disabled={busy != null} onClick={() => calculate(false)}>{busy === "preview" ? "Calculating…" : "Calculate"}</button>
        <button className="pda-button" disabled={busy != null || !result} onClick={() => calculate(true)}>{busy === "save" ? "Saving…" : "Save snapshot"}</button>
      </div>
    </header>
    {error && <div className="pda-alert pda-alert--error" role="alert">{error}</div>}
    {savedId && <div className="pda-alert pda-alert--success">Immutable estimate saved · {savedId}</div>}

    <section className="pda-layout">
      <div className="pda-form-stack">
        <section className="pda-card"><h2>1. Port call</h2><div className="pda-grid pda-grid--three">
          <label>Port<select value={portLocode} onChange={(e) => { setPortLocode(e.target.value); setTerminalId(""); }}>{ports.map((port) => <option key={port.locode} value={port.locode}>{port.name} · {port.locode}</option>)}</select></label>
          <label>Terminal<select value={terminalId} onChange={(e) => setTerminalId(e.target.value)}><option value="">Port-wide / not specified</option>{terminalOptions.map((terminal) => <option key={terminal.id} value={terminal.id}>{terminal.name}</option>)}</select></label>
          <label>Call date<input type="date" value={callDate} onChange={(e) => setCallDate(e.target.value)} /></label>
        </div><div className={`pda-coverage ${covered ? "is-covered" : "is-manual"}`}>{covered ? "Current published coverage exists; the selected call date is verified when you calculate." : "No current published tariff is available. An authorized manual quotation is required."}</div></section>

        <section className="pda-card"><h2>2. Vessel particulars</h2>
          <label>Vessel<select value={vesselId} onChange={(e) => selectVessel(e.target.value)}><option value="">Enter manually</option>{vessels.map((item) => <option key={item.id} value={item.id}>{item.name} · IMO {item.imo}</option>)}</select></label>
          <div className="pda-grid pda-grid--six">
            <Numeric label="GT" value={gt} set={setGt}/><Numeric label="NT" value={nt} set={setNt}/><Numeric label="SCNRT" value={scnrt} set={setScnrt}/><Numeric label="DWT" value={dwt} set={setDwt}/><Numeric label="LOA (m)" value={loa} set={setLoa}/><Numeric label="Draft (m)" value={draft} set={setDraft}/>
          </div>
        </section>

        <section className="pda-card"><h2>3. Call particulars</h2><div className="pda-grid pda-grid--three">
          <Numeric label="Days in port" value={days} set={setDays}/><Numeric label="Hours (optional)" value={hours} set={setHours}/><Numeric label="Cargo quantity MT" value={cargoQuantity} set={setCargoQuantity}/>
          <label>Cargo status<select value={cargoStatus} onChange={(e) => setCargoStatus(e.target.value as typeof cargoStatus)}><option value="laden">Laden</option><option value="ballast">Ballast</option></select></label>
          <label>Location<select value={location} onChange={(e) => setLocation(e.target.value as typeof location)}><option value="alongside">Alongside</option><option value="anchorage">Anchorage</option></select></label>
          <label>Convert to<input maxLength={3} placeholder="USD" value={convertedCurrency} onChange={(e) => setConvertedCurrency(e.target.value.toUpperCase())}/></label>
          <Numeric label="FX rate (native × rate)" value={fxRate} set={setFxRate}/>
        </div><fieldset className="pda-services"><legend>Requested services</legend>{SERVICES.map((service) => <label key={service}><input type="checkbox" checked={services.includes(service)} onChange={() => setServices((rows) => rows.includes(service) ? rows.filter((item) => item !== service) : [...rows, service])}/> {service.replaceAll("_", " ")}</label>)}</fieldset></section>

        {manualLines.length > 0 && <section className="pda-card"><h2>Authorized manual quotations</h2>{manualLines.map((line, index) => <div className="pda-manual" key={`${line.ruleCode ?? "extra"}-${index}`}>
          <input aria-label="Manual line label" value={line.label} onChange={(e) => setManualLines((rows) => rows.map((row, i) => i === index ? {...row, label:e.target.value} : row))}/>
          <input aria-label="Manual line amount" inputMode="decimal" value={line.amount} onChange={(e) => setManualLines((rows) => rows.map((row, i) => i === index ? {...row, amount:numberOrNull(e.target.value) ?? 0} : row))}/>
          <input aria-label="Manual line reason" value={line.reason} onChange={(e) => setManualLines((rows) => rows.map((row, i) => i === index ? {...row, reason:e.target.value} : row))}/>
          <button onClick={() => setManualLines((rows) => rows.filter((_, i) => i !== index))}>Remove</button>
        </div>)}<button className="pda-link-button" onClick={() => addManualLine()}>+ Add manual charge</button></section>}
      </div>

      <aside className="pda-results pda-card"><div className="pda-results__head"><div><span className="pda-eyebrow">Proforma estimate</span><h2>{result ? money(result.totals.native,result.nativeCurrency) : "Not calculated"}</h2></div>{result && <span className={`pda-badge pda-badge--${result.coverage}`}>{result.coverage.replaceAll("_"," ")}</span>}</div>
        {result?.convertedCurrency && result.totals.converted != null && <p className="pda-converted">{money(result.totals.converted,result.convertedCurrency)}</p>}
        {!result && <div className="pda-empty">Complete the call facts, then calculate. Rates are restricted to the exact port and effective date.</div>}
        {result?.warnings.map((warning,index) => <div className="pda-warning" key={`${warning.code}-${warning.ruleCode ?? index}`}><strong>{warning.code.replaceAll("_"," ")}</strong><span>{warning.message}</span>{warning.code === "MANUAL_QUOTE_REQUIRED" && !manualLines.some((line) => line.ruleCode === warning.ruleCode) && <button onClick={() => addManualLine(warning.ruleCode)}>Enter quote</button>}</div>)}
        {result?.lines.map((line,index) => <details className="pda-line" key={`${line.ruleCode ?? "manual"}-${index}`}><summary><span>{line.label}{line.manual && <em>manual</em>}</span><strong>{money(line.amount,result.nativeCurrency)}</strong></summary><p>{line.explanation}</p>{line.evidence.title && <div className="pda-evidence"><b>Source:</b> {line.evidence.title}{line.evidence.page ? ` · page ${line.evidence.page}` : ""}{line.evidence.sheet ? ` · sheet ${line.evidence.sheet}` : ""}</div>}</details>)}
        {result && <p className="pda-disclaimer">Estimate only. Saving creates an immutable snapshot; it does not replace the appointed agent&apos;s final DA.</p>}
      </aside>
    </section>
  </main>;
}

function Numeric({ label, value, set }: { label: string; value: string; set: (value:string) => void }) {
  return <label>{label}<input inputMode="decimal" value={value} onChange={(e) => set(e.target.value)}/></label>;
}
