"use client";

import * as React from "react";
import {
  Anchor,
  CalendarDays,
  ChevronRight,
  Loader2,
  Map,
  Package,
  Plus,
  Settings2,
  Ship,
  UserRound,
  X,
} from "lucide-react";

import { previewPdaRoute } from "@/app/(dashboard)/dashboard/ports-da/actions";
import type {
  PdaEstimatorBootstrap,
  PdaEstimatorCargoOption,
  PdaEstimatorTab,
  PdaEstimatorVesselOption,
} from "@/lib/pda/estimator-contract";
import { dateTimeLocalUtcIso, formatUtcTimelineInstant } from "@/lib/pda/route-datetime";
import {
  PDA_ROUTE_SERVICE_OPTIONS,
  type PdaRouteLegInput,
  type PdaRouteFxRate,
  type PdaRouteManualLineInput,
  type PdaRouteNotSourcedItem,
  type PdaRoutePreviewInput,
  type PdaRoutePreviewResult,
  type PdaRouteServiceCode,
} from "@/lib/pda/route-types";
import type { PdaCoverageItem, PdaTerminalItem } from "@/sdk/app/pda";

import "@/components/design-system/asb-ds.css";
import "./pda-route-estimator.css";

interface Props {
  bootstrap: PdaEstimatorBootstrap;
  coverage: PdaCoverageItem[];
  terminals: PdaTerminalItem[];
}

const TABS: Array<{ id: PdaEstimatorTab; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { id: "estimate", label: "Estimate", icon: Ship },
  { id: "ports", label: "Ports", icon: Map },
  { id: "agents", label: "Agents", icon: UserRound },
  { id: "setup", label: "Setup", icon: Settings2 },
];

function numberFromText(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value.replaceAll(",", ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function positiveFromText(value: string): number | null {
  const parsed = numberFromText(value);
  return parsed != null && parsed > 0 ? parsed : null;
}

function calendarDate(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

interface ManualQuoteDraft {
  id: string;
  ruleCode: string;
  label: string;
  amount: string;
  reason: string;
}

function manualLinesFromDrafts(drafts: ManualQuoteDraft[]): PdaRouteManualLineInput[] | null {
  const lines: PdaRouteManualLineInput[] = [];
  for (const draft of drafts) {
    const amount = numberFromText(draft.amount);
    const label = draft.label.trim();
    const reason = draft.reason.trim();
    if (!label || amount == null || reason.length < 3) return null;
    lines.push({
      ...(draft.ruleCode.trim() ? { ruleCode: draft.ruleCode.trim() } : {}),
      label,
      amount,
      reason,
    });
  }
  return lines;
}

function compactNumber(value: number | null, suffix = ""): string {
  if (value == null) return "—";
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value)}${suffix}`;
}

function money(value: number | null, currency: string): string {
  if (value == null) return "NOT SOURCED";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currency} ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value)}`;
  }
}

function routeLeg(input: {
  portLocode: string;
  terminalId: string;
  callDate: string;
  cargoStatus: "laden" | "ballast";
  voyageScope: "domestic" | "international";
  location: "alongside" | "anchorage";
  settlementMode: "" | "cash" | "agent_account";
  requestedServices: PdaRouteServiceCode[];
  manualLines: PdaRouteManualLineInput[];
}): PdaRouteLegInput {
  return {
    portLocode: input.portLocode,
    terminalId: input.terminalId || null,
    callDate: input.callDate,
    call: {
      cargoStatus: input.cargoStatus,
      voyageScope: input.voyageScope,
      location: input.location,
      // No default: an unanswered settlement leaves rules that depend on it as MISSING_INPUT.
      settlementMode: input.settlementMode || null,
      requestedServices: input.requestedServices,
    },
    ...(input.manualLines.length ? { manualLines: input.manualLines } : {}),
  };
}

export function PdaRouteEstimator({ bootstrap, terminals }: Props) {
  const initialCargo = bootstrap.catalog.cargos.find((item) => item.id === bootstrap.initial.cargoId) ?? null;
  const [activeTab, setActiveTab] = React.useState<PdaEstimatorTab>("estimate");
  const [vesselId, setVesselId] = React.useState(bootstrap.initial.vesselId ?? "");
  const [cargoId, setCargoId] = React.useState(bootstrap.initial.cargoId ?? "");
  const [loadPort, setLoadPort] = React.useState(bootstrap.initial.loadPortLocode ?? "");
  const [dischargePort, setDischargePort] = React.useState(bootstrap.initial.dischargePortLocode ?? "");
  const [quantity, setQuantity] = React.useState(
    bootstrap.initial.quantityMt == null ? "" : String(bootstrap.initial.quantityMt),
  );
  const [allocation, setAllocation] = React.useState(bootstrap.initial.allocation);
  const [etaLoad, setEtaLoad] = React.useState("");
  const [loadCallDate, setLoadCallDate] = React.useState("");
  const [dischargeCallDate, setDischargeCallDate] = React.useState("");
  const [loadTurn, setLoadTurn] = React.useState("");
  const [dischargeTurn, setDischargeTurn] = React.useState("");
  const [loadRate, setLoadRate] = React.useState(initialCargo?.loadRateMtPerDay == null ? "" : String(initialCargo.loadRateMtPerDay));
  const [dischargeRate, setDischargeRate] = React.useState(initialCargo?.dischargeRateMtPerDay == null ? "" : String(initialCargo.dischargeRateMtPerDay));
  const [passageDistance, setPassageDistance] = React.useState("");
  const [passageSpeed, setPassageSpeed] = React.useState("");
  const [dailyOpex, setDailyOpex] = React.useState("");
  const [cargoStatus, setCargoStatus] = React.useState<"" | "laden" | "ballast">("");
  const [voyageScope, setVoyageScope] = React.useState<"" | "domestic" | "international">("");
  const [loadLocation, setLoadLocation] = React.useState<"" | "alongside" | "anchorage">("");
  const [dischargeLocation, setDischargeLocation] = React.useState<"" | "alongside" | "anchorage">("");
  // Settlement per port call (C2B-009): separate from the payer allocation, never defaulted.
  const [loadSettlement, setLoadSettlement] = React.useState<"" | "cash" | "agent_account">("");
  const [dischargeSettlement, setDischargeSettlement] = React.useState<"" | "cash" | "agent_account">("");
  const [loadRequestedServices, setLoadRequestedServices] = React.useState<PdaRouteServiceCode[]>([]);
  const [dischargeRequestedServices, setDischargeRequestedServices] = React.useState<PdaRouteServiceCode[]>([]);
  const [loadManualLines, setLoadManualLines] = React.useState<ManualQuoteDraft[]>([]);
  const [dischargeManualLines, setDischargeManualLines] = React.useState<ManualQuoteDraft[]>([]);
  const [loadTerminal, setLoadTerminal] = React.useState("");
  const [dischargeTerminal, setDischargeTerminal] = React.useState("");
  const [result, setResult] = React.useState<PdaRoutePreviewResult | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const requestSequence = React.useRef(0);
  const manualLineSequence = React.useRef(0);

  const vessel = bootstrap.catalog.vessels.find((item) => item.id === vesselId) ?? null;
  const cargo = bootstrap.catalog.cargos.find((item) => item.id === cargoId) ?? null;
  const quantityMt = numberFromText(quantity);
  const loadPortRecord = bootstrap.catalog.ports.find((item) => item.locode === loadPort) ?? null;
  const dischargePortRecord = bootstrap.catalog.ports.find((item) => item.locode === dischargePort) ?? null;
  const loadTerminals = terminals.filter((item) => item.portLocode === loadPort);
  const dischargeTerminals = terminals.filter((item) => item.portLocode === dischargePort);
  const selected = Boolean(vessel && cargo);
  const selectionReady = Boolean(
    selected
    && quantityMt != null
    && quantityMt > 0
    && loadPortRecord
    && dischargePortRecord
    && bootstrap.catalogState === "ready",
  );
  const etaLoadIso = dateTimeLocalUtcIso(etaLoad);
  const loadCallDateValue = calendarDate(loadCallDate);
  const dischargeCallDateValue = calendarDate(dischargeCallDate);
  const loadTurnDays = numberFromText(loadTurn);
  const dischargeTurnDays = numberFromText(dischargeTurn);
  const loadProductivity = positiveFromText(loadRate);
  const dischargeProductivity = positiveFromText(dischargeRate);
  const passageDistanceNm = positiveFromText(passageDistance);
  const passageSpeedKnots = positiveFromText(passageSpeed);
  const parsedLoadManualLines = React.useMemo(() => manualLinesFromDrafts(loadManualLines), [loadManualLines]);
  const parsedDischargeManualLines = React.useMemo(
    () => manualLinesFromDrafts(dischargeManualLines),
    [dischargeManualLines],
  );
  const previewMissing: string[] = [];
  if (!etaLoadIso) previewMissing.push("load-port ETA");
  if (!loadCallDateValue) previewMissing.push("load-port local call date");
  if (!dischargeCallDateValue) previewMissing.push("discharge-port local call date");
  if (loadTurnDays == null) previewMissing.push("load turn time (zero is allowed)");
  if (dischargeTurnDays == null) previewMissing.push("discharge turn time (zero is allowed)");
  if (loadProductivity == null) previewMissing.push("load productivity");
  if (dischargeProductivity == null) previewMissing.push("discharge productivity");
  if (passageDistanceNm == null) previewMissing.push("passage distance");
  if (passageSpeedKnots == null) previewMissing.push("passage speed");
  if (!cargoStatus) previewMissing.push("cargo status");
  if (!voyageScope) previewMissing.push("voyage scope");
  if (!loadLocation) previewMissing.push("load-port location");
  if (!dischargeLocation) previewMissing.push("discharge-port location");
  if (!loadRequestedServices.length) previewMissing.push("at least one load-port requested service");
  if (!dischargeRequestedServices.length) previewMissing.push("at least one discharge-port requested service");
  if (parsedLoadManualLines == null) previewMissing.push("complete load-port manual quote fields");
  if (parsedDischargeManualLines == null) previewMissing.push("complete discharge-port manual quote fields");
  const ready = selectionReady && previewMissing.length === 0;

  React.useEffect(() => {
    setLoadTerminal("");
  }, [loadPort]);

  React.useEffect(() => {
    setDischargeTerminal("");
  }, [dischargePort]);

  React.useEffect(() => {
    const sequence = ++requestSequence.current;
    setResult(null);
    setError("");
    if (
      !ready
      || !vessel
      || !cargo
      || quantityMt == null
      || !etaLoadIso
      || !loadCallDateValue
      || !dischargeCallDateValue
      || loadTurnDays == null
      || dischargeTurnDays == null
      || loadProductivity == null
      || dischargeProductivity == null
      || passageDistanceNm == null
      || passageSpeedKnots == null
      || !cargoStatus
      || !voyageScope
      || !loadLocation
      || !dischargeLocation
      || parsedLoadManualLines == null
      || parsedDischargeManualLines == null
    ) {
      setBusy(false);
      return;
    }

    const loadRequest = routeLeg({
      portLocode: loadPort,
      terminalId: loadTerminal,
      callDate: loadCallDateValue,
      cargoStatus,
      voyageScope,
      location: loadLocation,
      settlementMode: loadSettlement,
      requestedServices: loadRequestedServices,
      manualLines: parsedLoadManualLines,
    });
    const dischargeRequest = routeLeg({
      portLocode: dischargePort,
      terminalId: dischargeTerminal,
      callDate: dischargeCallDateValue,
      cargoStatus,
      voyageScope,
      location: dischargeLocation,
      settlementMode: dischargeSettlement,
      requestedServices: dischargeRequestedServices,
      manualLines: parsedDischargeManualLines,
    });
    const input: PdaRoutePreviewInput = {
      selection: {
        vesselAvailabilityId: vessel.id,
        cargoId: cargo.id,
        quantityMt,
      },
      displayCurrency: "USD",
      allocation,
      load: loadRequest,
      discharge: dischargeRequest,
      timeline: {
        etaLoad: etaLoadIso,
        loadTurnDays,
        loadProductivityMtPerDay: loadProductivity,
        passageDistanceNm,
        passageSpeedKnots,
        dischargeTurnDays,
        dischargeProductivityMtPerDay: dischargeProductivity,
        dailyOpex: numberFromText(dailyOpex),
      },
    };

    setBusy(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await previewPdaRoute(input);
          if (requestSequence.current !== sequence) return;
          if (response.ok) setResult(response.data);
          else setError(response.error);
        } catch (cause) {
          if (requestSequence.current === sequence) {
            setError(cause instanceof Error ? cause.message : "Unable to calculate route PDA");
          }
        } finally {
          if (requestSequence.current === sequence) setBusy(false);
        }
      })();
    }, 250);
    return () => {
      window.clearTimeout(timer);
      if (requestSequence.current === sequence) requestSequence.current += 1;
    };
  }, [
    allocation,
    cargo,
    cargoStatus,
    dailyOpex,
    dischargeCallDate,
    dischargeCallDateValue,
    dischargeLocation,
    dischargeSettlement,
    dischargeManualLines,
    dischargePort,
    dischargeRate,
    dischargeProductivity,
    dischargeTerminal,
    dischargeTurn,
    dischargeTurnDays,
    dischargeRequestedServices,
    etaLoad,
    etaLoadIso,
    loadCallDate,
    loadCallDateValue,
    loadLocation,
    loadSettlement,
    loadManualLines,
    loadPort,
    loadRate,
    loadProductivity,
    loadTerminal,
    loadTurn,
    loadTurnDays,
    loadRequestedServices,
    passageDistance,
    passageDistanceNm,
    passageSpeed,
    passageSpeedKnots,
    parsedDischargeManualLines,
    parsedLoadManualLines,
    quantityMt,
    ready,
    vessel,
    voyageScope,
  ]);

  function reset() {
    ++requestSequence.current;
    setVesselId("");
    setCargoId("");
    setLoadPort("");
    setDischargePort("");
    setQuantity("");
    setEtaLoad("");
    setLoadCallDate("");
    setDischargeCallDate("");
    setLoadTurn("");
    setDischargeTurn("");
    setLoadRate("");
    setDischargeRate("");
    setPassageDistance("");
    setPassageSpeed("");
    setDailyOpex("");
    setCargoStatus("");
    setVoyageScope("");
    setLoadLocation("");
    setDischargeLocation("");
    // Settlement is restated for every estimate (C2B-013): never carried into a new one.
    setLoadSettlement("");
    setDischargeSettlement("");
    setLoadRequestedServices([]);
    setDischargeRequestedServices([]);
    setLoadManualLines([]);
    setDischargeManualLines([]);
    setLoadTerminal("");
    setDischargeTerminal("");
    setResult(null);
    setError("");
    setBusy(false);
  }

  function chooseCargo(nextId: string) {
    const nextCargo = bootstrap.catalog.cargos.find((item) => item.id === nextId) ?? null;
    setCargoId(nextId);
    setQuantity(nextCargo ? String(nextCargo.quantityMaxMt ?? nextCargo.quantityMinMt ?? "") : "");
    setLoadPort(nextCargo?.loadPort.scope === "port" ? nextCargo.loadPort.locode ?? "" : "");
    setDischargePort(nextCargo?.dischargePort.scope === "port" ? nextCargo.dischargePort.locode ?? "" : "");
    setLoadRate(nextCargo?.loadRateMtPerDay == null ? "" : String(nextCargo.loadRateMtPerDay));
    setDischargeRate(nextCargo?.dischargeRateMtPerDay == null ? "" : String(nextCargo.dischargeRateMtPerDay));
    setLoadTerminal("");
    setDischargeTerminal("");
  }

  function addManualLine(side: "load" | "discharge") {
    const draft: ManualQuoteDraft = {
      id: `${side}-${++manualLineSequence.current}`,
      ruleCode: "",
      label: "",
      amount: "",
      reason: "",
    };
    (side === "load" ? setLoadManualLines : setDischargeManualLines)((current) => [...current, draft]);
  }

  function updateManualLine(
    side: "load" | "discharge",
    id: string,
    field: Exclude<keyof ManualQuoteDraft, "id">,
    value: string,
  ) {
    (side === "load" ? setLoadManualLines : setDischargeManualLines)((current) => current.map((line) => (
      line.id === id ? { ...line, [field]: value } : line
    )));
  }

  function removeManualLine(side: "load" | "discharge", id: string) {
    (side === "load" ? setLoadManualLines : setDischargeManualLines)((current) => (
      current.filter((line) => line.id !== id)
    ));
  }

  const subtitle = selected && vessel && cargo
    ? `${vessel.name} · ${cargo.cargo} · ${loadPortRecord?.name ?? "load port open"} → ${dischargePortRecord?.name ?? "discharge port open"}`
    : "A vessel and a cargo, and both port costs";

  return (
    <main className={`asb-ds pda-route pda-route--${bootstrap.initial.density}`}>
      <header className="pda-route__header">
        <h1>Ports Cost Estimator</h1>
        <p>{subtitle}</p>
      </header>

      <nav
        className="pda-route__tabs asb-tabs"
        aria-label="Ports Cost Estimator sections"
        role="tablist"
        onKeyDown={(event) => {
          const current = TABS.findIndex((tab) => tab.id === activeTab);
          let next = current;
          if (event.key === "ArrowRight") next = (current + 1) % TABS.length;
          else if (event.key === "ArrowLeft") next = (current - 1 + TABS.length) % TABS.length;
          else if (event.key === "Home") next = 0;
          else if (event.key === "End") next = TABS.length - 1;
          else return;
          event.preventDefault();
          setActiveTab(TABS[next]!.id);
          document.getElementById(`pda-tab-${TABS[next]!.id}`)?.focus();
        }}
      >
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            className="asb-tab"
            key={id}
            id={`pda-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            aria-controls="pda-tabpanel"
            tabIndex={activeTab === id ? 0 : -1}
            onClick={() => setActiveTab(id)}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </nav>

      <section
        className="pda-route__panel"
        id="pda-tabpanel"
        role="tabpanel"
        aria-labelledby={`pda-tab-${activeTab}`}
      >
      {activeTab !== "estimate" ? (
        <section className="pda-route__deferred asb-card" aria-labelledby="pda-deferred-title">
          <span className="pda-route__deferred-icon"><Settings2 size={22} /></span>
          <div>
            <h2 id="pda-deferred-title">{TABS.find((tab) => tab.id === activeTab)?.label} workspace</h2>
            <p>This tab is preserved from the approved design. Its governed data workflow will be connected in the next module increment.</p>
          </div>
        </section>
      ) : (
        <>
          <section className={`pda-selection asb-card ${selected ? "is-selected" : ""}`} aria-label="Estimate records">
            {selected && vessel && cargo ? (
              <>
                <SelectedRecord
                  label="Vessel"
                  title={vessel.name}
                  detail={`${vessel.type} · ${vessel.dwt} DWT · ${compactNumber(vessel.gt, " GRT")} · LOA ${compactNumber(vessel.loaM, " m")}`}
                  onClear={() => setVesselId("")}
                />
                <SelectedRecord
                  label="Cargo"
                  title={cargo.cargo}
                  detail={`${cargo.quantityLabel} · ${cargo.loadPort.name} → ${cargo.dischargePort.name}`}
                  onClear={() => chooseCargo("")}
                />
                <button type="button" className="asb-button pda-selection__new" onClick={reset}>
                  <Plus size={14} /> New
                </button>
              </>
            ) : (
              <>
                <CatalogPicker
                  kind="vessel"
                  items={bootstrap.catalog.vessels}
                  value={vesselId}
                  onChange={setVesselId}
                  disabled={bootstrap.catalogState !== "ready"}
                />
                <CatalogPicker
                  kind="cargo"
                  items={bootstrap.catalog.cargos}
                  value={cargoId}
                  onChange={chooseCargo}
                  disabled={bootstrap.catalogState !== "ready"}
                />
              </>
            )}
          </section>

          {bootstrap.notices.map((notice) => (
            <div className="pda-route__notice" role="status" key={notice.code}>{notice.message}</div>
          ))}

          {!selected || !vessel || !cargo ? (
            <section className="pda-empty-state asb-card">
              <div className="pda-empty-state__icons" aria-hidden="true"><Ship size={23} /><Package size={23} /></div>
              <h2>Pick a vessel and a cargo.</h2>
              <p>Both come from your own records. The vessel is the reference; the cargo supplies quantity, type and the two ports. Both PDAs are priced from the tariff that governs each port, then from quotes, and say not sourced where neither exists.</p>
            </section>
          ) : (
            <div className="pda-workspace">
              {!loadPortRecord || !dischargePortRecord ? (
                <PortChoice
                  ports={bootstrap.catalog.ports}
                  loadPort={loadPort}
                  dischargePort={dischargePort}
                  onLoadPort={setLoadPort}
                  onDischargePort={setDischargePort}
                />
              ) : null}

              <CallFactsPanel
                loadCallDate={loadCallDate}
                onLoadCallDate={setLoadCallDate}
                dischargeCallDate={dischargeCallDate}
                onDischargeCallDate={setDischargeCallDate}
                cargoStatus={cargoStatus}
                onCargoStatus={setCargoStatus}
                voyageScope={voyageScope}
                onVoyageScope={setVoyageScope}
                loadLocation={loadLocation}
                onLoadLocation={setLoadLocation}
                dischargeLocation={dischargeLocation}
                onDischargeLocation={setDischargeLocation}
                loadSettlement={loadSettlement}
                onLoadSettlement={setLoadSettlement}
                dischargeSettlement={dischargeSettlement}
                onDischargeSettlement={setDischargeSettlement}
                loadRequestedServices={loadRequestedServices}
                onToggleLoadService={(service) => setLoadRequestedServices((current) => (
                  current.includes(service)
                    ? current.filter((item) => item !== service)
                    : [...current, service]
                ))}
                dischargeRequestedServices={dischargeRequestedServices}
                onToggleDischargeService={(service) => setDischargeRequestedServices((current) => (
                  current.includes(service)
                    ? current.filter((item) => item !== service)
                    : [...current, service]
                ))}
              />

              {selectionReady && previewMissing.length ? (
                <div className="pda-route__notice pda-route__notice--blocking" role="status">
                  Preview blocked: provide {previewMissing.join(", ")}. Tariff-driving values are never defaulted.
                </div>
              ) : null}

              <SummaryPanel
                vessel={vessel}
                cargo={cargo}
                quantity={quantity}
                onQuantity={setQuantity}
                allocation={allocation}
                onAllocation={setAllocation}
                result={result}
                busy={busy}
                error={error}
                loadName={loadPortRecord?.name ?? "Open"}
                dischargeName={dischargePortRecord?.name ?? "Open"}
              />

              <TimelinePanel
                result={result}
                etaLoad={etaLoad}
                onEtaLoad={setEtaLoad}
                loadTurn={loadTurn}
                onLoadTurn={setLoadTurn}
                loadRate={loadRate}
                onLoadRate={setLoadRate}
                passageDistance={passageDistance}
                onPassageDistance={setPassageDistance}
                passageSpeed={passageSpeed}
                onPassageSpeed={setPassageSpeed}
                suggestedSpeed={vessel.serviceSpeed}
                dailyOpex={dailyOpex}
                onDailyOpex={setDailyOpex}
                dischargeTurn={dischargeTurn}
                onDischargeTurn={setDischargeTurn}
                dischargeRate={dischargeRate}
                onDischargeRate={setDischargeRate}
                loadName={loadPortRecord?.name ?? "Open"}
                dischargeName={dischargePortRecord?.name ?? "Open"}
              />

              <section className="pda-port-grid" aria-label="Port estimates">
                <PortEstimateCard
                  side="load"
                  port={loadPortRecord}
                  locode={loadPort}
                  terminals={loadTerminals}
                  terminalId={loadTerminal}
                  onTerminal={setLoadTerminal}
                  days={result?.timeline.loadPortDays ?? null}
                  result={result?.legs.load ?? null}
                  displayTotal={result?.totals.loadPort ?? null}
                  knownSubtotal={result?.totals.loadPortKnown ?? null}
                  displayCurrency={result?.displayCurrency ?? "USD"}
                  notSourced={result?.notSourced.filter((item) => item.provenance.leg === "load") ?? []}
                  fx={result?.fxRates?.find((rate) => rate.leg === "load") ?? null}
                  manualLines={loadManualLines}
                  onAddManualLine={() => addManualLine("load")}
                  onUpdateManualLine={(id, field, value) => updateManualLine("load", id, field, value)}
                  onRemoveManualLine={(id) => removeManualLine("load", id)}
                  busy={busy}
                />
                <PortEstimateCard
                  side="discharge"
                  port={dischargePortRecord}
                  locode={dischargePort}
                  terminals={dischargeTerminals}
                  terminalId={dischargeTerminal}
                  onTerminal={setDischargeTerminal}
                  days={result?.timeline.dischargePortDays ?? null}
                  result={result?.legs.discharge ?? null}
                  displayTotal={result?.totals.dischargePort ?? null}
                  knownSubtotal={result?.totals.dischargePortKnown ?? null}
                  displayCurrency={result?.displayCurrency ?? "USD"}
                  notSourced={result?.notSourced.filter((item) => item.provenance.leg === "discharge") ?? []}
                  fx={result?.fxRates?.find((rate) => rate.leg === "discharge") ?? null}
                  manualLines={dischargeManualLines}
                  onAddManualLine={() => addManualLine("discharge")}
                  onUpdateManualLine={(id, field, value) => updateManualLine("discharge", id, field, value)}
                  onRemoveManualLine={(id) => removeManualLine("discharge", id)}
                  busy={busy}
                />
              </section>
            </div>
          )}
        </>
      )}
      </section>
    </main>
  );
}

function SelectedRecord({ label, title, detail, onClear }: { label: string; title: string; detail: string; onClear: () => void }) {
  return (
    <div className="pda-selection__record">
      <span className="pda-selection__label">{label}</span>
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
      <button type="button" aria-label={`Clear ${label.toLowerCase()}`} onClick={onClear}><X size={13} /></button>
    </div>
  );
}

type PickerItem = PdaEstimatorVesselOption | PdaEstimatorCargoOption;

function CatalogPicker({
  kind,
  items,
  value,
  onChange,
  disabled,
}: {
  kind: "vessel" | "cargo";
  items: PickerItem[];
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(-1);
  const selected = items.find((item) => item.id === value) ?? null;
  const filtered = items.filter((item) => {
    const text = "name" in item
      ? `${item.name} ${item.imo} ${item.type} ${item.dwt}`
      : `${item.cargo} ${item.commodity} ${item.type} ${item.refId}`;
    return text.toLowerCase().includes(query.trim().toLowerCase());
  }).slice(0, 8);
  const label = kind === "vessel" ? "Vessel" : "Cargo";
  const selectedLabel = selected ? ("name" in selected ? selected.name : selected.cargo) : "";
  const activeItem = activeIndex >= 0 ? filtered[activeIndex] ?? null : null;

  function choose(item: PickerItem) {
    onChange(item.id);
    setQuery("");
    setOpen(false);
    setActiveIndex(-1);
  }

  return (
    <div className="pda-picker">
      <label htmlFor={`pda-${kind}-search`}>{label}</label>
      <div className="pda-picker__control">
        {kind === "vessel" ? <Ship size={15} /> : <Package size={15} />}
        <input
          id={`pda-${kind}-search`}
          className="asb-control"
          value={open ? query : selectedLabel}
          placeholder={kind === "vessel" ? "Search your fleet" : "Search your cargoes"}
          disabled={disabled}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={`pda-${kind}-options`}
          aria-autocomplete="list"
          aria-activedescendant={activeItem ? `pda-${kind}-option-${activeItem.id}` : undefined}
          onFocus={() => { setQuery(""); setOpen(true); setActiveIndex(-1); }}
          onBlur={() => window.setTimeout(() => { setOpen(false); setActiveIndex(-1); }, 120)}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); setActiveIndex(-1); }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
              if (!filtered.length) {
                setActiveIndex(-1);
                return;
              }
              setActiveIndex((index) => Math.min(index + 1, filtered.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              if (!filtered.length) {
                setActiveIndex(-1);
                return;
              }
              setActiveIndex((index) => Math.max(index - 1, 0));
            } else if (event.key === "Enter" && activeIndex >= 0 && filtered[activeIndex]) {
              event.preventDefault();
              choose(filtered[activeIndex]);
            } else if (event.key === "Escape") {
              setOpen(false);
              setActiveIndex(-1);
            }
          }}
        />
        {selected ? <button type="button" onClick={() => onChange("")} aria-label={`Clear ${label.toLowerCase()}`}><X size={13} /></button> : null}
      </div>
      {open && !disabled ? (
        <div className="pda-picker__menu asb-card" id={`pda-${kind}-options`} role="listbox">
          {filtered.length ? filtered.map((item) => (
            <button
              key={item.id}
              id={`pda-${kind}-option-${item.id}`}
              type="button"
              role="option"
              aria-selected={item.id === value}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(filtered.indexOf(item))}
              onClick={() => choose(item)}
            >
              <strong>{"name" in item ? item.name : item.cargo}</strong>
              <span>{"name" in item ? `${item.type} · ${item.dwt} DWT · IMO ${item.imo}` : `${item.quantityLabel} · ${item.loadPort.name} → ${item.dischargePort.name}`}</span>
            </button>
          )) : <p>No authorised {kind === "vessel" ? "vessels" : "cargoes"} match this search.</p>}
        </div>
      ) : null}
    </div>
  );
}

function PortChoice({
  ports,
  loadPort,
  dischargePort,
  onLoadPort,
  onDischargePort,
}: {
  ports: PdaEstimatorBootstrap["catalog"]["ports"];
  loadPort: string;
  dischargePort: string;
  onLoadPort: (value: string) => void;
  onDischargePort: (value: string) => void;
}) {
  return (
    <section className="pda-port-choice asb-card" aria-labelledby="pda-port-choice-title">
      <div>
        <h2 id="pda-port-choice-title">Choose the exact ports</h2>
        <p>The selected cargo carries a range or area. Pricing starts only after both specific ports are confirmed.</p>
      </div>
      <label>Load port<select className="asb-control" value={loadPort} onChange={(event) => onLoadPort(event.target.value)}><option value="">Choose load port</option>{ports.map((port) => <option key={`load-${port.locode}`} value={port.locode}>{port.name} · {port.locode}</option>)}</select></label>
      <label>Discharge port<select className="asb-control" value={dischargePort} onChange={(event) => onDischargePort(event.target.value)}><option value="">Choose discharge port</option>{ports.map((port) => <option key={`discharge-${port.locode}`} value={port.locode}>{port.name} · {port.locode}</option>)}</select></label>
    </section>
  );
}

function CallFactsPanel(props: {
  loadCallDate: string;
  onLoadCallDate: (value: string) => void;
  dischargeCallDate: string;
  onDischargeCallDate: (value: string) => void;
  cargoStatus: "" | "laden" | "ballast";
  onCargoStatus: (value: "" | "laden" | "ballast") => void;
  voyageScope: "" | "domestic" | "international";
  onVoyageScope: (value: "" | "domestic" | "international") => void;
  loadLocation: "" | "alongside" | "anchorage";
  onLoadLocation: (value: "" | "alongside" | "anchorage") => void;
  dischargeLocation: "" | "alongside" | "anchorage";
  onDischargeLocation: (value: "" | "alongside" | "anchorage") => void;
  loadSettlement: "" | "cash" | "agent_account";
  onLoadSettlement: (value: "" | "cash" | "agent_account") => void;
  dischargeSettlement: "" | "cash" | "agent_account";
  onDischargeSettlement: (value: "" | "cash" | "agent_account") => void;
  loadRequestedServices: PdaRouteServiceCode[];
  onToggleLoadService: (service: PdaRouteServiceCode) => void;
  dischargeRequestedServices: PdaRouteServiceCode[];
  onToggleDischargeService: (service: PdaRouteServiceCode) => void;
}) {
  return (
    <section className="pda-call-facts asb-card" aria-labelledby="pda-call-facts-title">
      <div className="pda-call-facts__head">
        <h2 id="pda-call-facts-title">Tariff call facts</h2>
        <p>Confirm each fact used to select applicable tariff lines. No operational assumptions are preselected.</p>
      </div>
      <div className="pda-call-facts__selects">
        <label>
          Load-port local call date
          <input className="asb-control" type="date" required value={props.loadCallDate} onChange={(event) => props.onLoadCallDate(event.target.value)} />
        </label>
        <label>
          Discharge-port local call date
          <input className="asb-control" type="date" required value={props.dischargeCallDate} onChange={(event) => props.onDischargeCallDate(event.target.value)} />
        </label>
        <label>
          Cargo status
          <select className="asb-control" value={props.cargoStatus} onChange={(event) => props.onCargoStatus(event.target.value as typeof props.cargoStatus)}>
            <option value="">Choose status</option>
            <option value="laden">Laden</option>
            <option value="ballast">Ballast</option>
          </select>
        </label>
        <label>
          Voyage scope
          <select className="asb-control" value={props.voyageScope} onChange={(event) => props.onVoyageScope(event.target.value as typeof props.voyageScope)}>
            <option value="">Choose scope</option>
            <option value="international">International</option>
            <option value="domestic">Domestic</option>
          </select>
        </label>
        <label>
          Load-port location
          <select className="asb-control" value={props.loadLocation} onChange={(event) => props.onLoadLocation(event.target.value as typeof props.loadLocation)}>
            <option value="">Choose location</option>
            <option value="alongside">Alongside</option>
            <option value="anchorage">Anchorage</option>
          </select>
        </label>
        <label>
          Discharge-port location
          <select className="asb-control" value={props.dischargeLocation} onChange={(event) => props.onDischargeLocation(event.target.value as typeof props.dischargeLocation)}>
            <option value="">Choose location</option>
            <option value="alongside">Alongside</option>
            <option value="anchorage">Anchorage</option>
          </select>
        </label>
        <label>
          Load-port settlement
          <select className="asb-control" value={props.loadSettlement} onChange={(event) => props.onLoadSettlement(event.target.value as typeof props.loadSettlement)}>
            <option value="">Not stated</option>
            <option value="cash">Cash</option>
            <option value="agent_account">Agent account</option>
          </select>
        </label>
        <label>
          Discharge-port settlement
          <select className="asb-control" value={props.dischargeSettlement} onChange={(event) => props.onDischargeSettlement(event.target.value as typeof props.dischargeSettlement)}>
            <option value="">Not stated</option>
            <option value="cash">Cash</option>
            <option value="agent_account">Agent account</option>
          </select>
        </label>
      </div>
      <fieldset className="pda-call-facts__services">
        <legend>Load-port requested services</legend>
        {PDA_ROUTE_SERVICE_OPTIONS.map((service) => (
          <label key={`load-${service.code}`}>
            <input
              type="checkbox"
              checked={props.loadRequestedServices.includes(service.code)}
              onChange={() => props.onToggleLoadService(service.code)}
            />
            {service.label}
          </label>
        ))}
      </fieldset>
      <fieldset className="pda-call-facts__services">
        <legend>Discharge-port requested services</legend>
        {PDA_ROUTE_SERVICE_OPTIONS.map((service) => (
          <label key={`discharge-${service.code}`}>
            <input
              type="checkbox"
              checked={props.dischargeRequestedServices.includes(service.code)}
              onChange={() => props.onToggleDischargeService(service.code)}
            />
            {service.label}
          </label>
        ))}
      </fieldset>
    </section>
  );
}

function SummaryPanel({
  vessel,
  cargo,
  quantity,
  onQuantity,
  allocation,
  onAllocation,
  result,
  busy,
  error,
  loadName,
  dischargeName,
}: {
  vessel: PdaEstimatorVesselOption;
  cargo: PdaEstimatorCargoOption;
  quantity: string;
  onQuantity: (value: string) => void;
  allocation: "vessel" | "charterer";
  onAllocation: (value: "vessel" | "charterer") => void;
  result: PdaRoutePreviewResult | null;
  busy: boolean;
  error: string;
  loadName: string;
  dischargeName: string;
}) {
  const known = result?.totals.bothPortsKnown ?? null;
  return (
    <section className="pda-summary asb-card">
      <div className="pda-summary__bar">
        <strong>POL {loadName} → POD {dischargeName}</strong>
        <span>{compactNumber(result?.timeline.totalKnownDays ?? null, " days in port")}</span>
        <span>{result ? `${result.notSourced.length} items not sourced` : busy ? "Calculating governed rates…" : "Waiting for complete inputs"}</span>
        <a href="/dashboard/voyage-estimator">Voyage cost ↗</a>
        <div className="pda-segment" aria-label="Account allocation">
          <button type="button" aria-pressed={allocation === "vessel"} onClick={() => onAllocation("vessel")}>Vessel&apos;s Account</button>
          <button type="button" aria-pressed={allocation === "charterer"} onClick={() => onAllocation("charterer")}>Charterer&apos;s Account</button>
        </div>
      </div>
      <div className="pda-summary__context">
        <span>{vessel.name}</span><span>{cargo.cargo}</span>
        <label>Quantity <input value={quantity} inputMode="decimal" onChange={(event) => onQuantity(event.target.value)} /> MT</label>
      </div>
      {error ? <div className="pda-summary__error" role="alert">{error}</div> : null}
      <div className="pda-summary__tiles" aria-busy={busy}>
        <SummaryTile label="Known governed port subtotal" value={money(known, result?.displayCurrency ?? "USD")} note={result ? `POL ${money(result.totals.loadPortKnown, result.displayCurrency)} · POD ${money(result.totals.dischargePortKnown, result.displayCurrency)}` : "Requires explicit call facts"} />
        <SummaryTile label="Both ports · incl. handling & agency" value={money(result?.totals.handlingAndAgencyComplete ?? null, result?.displayCurrency ?? "USD")} note={result?.totals.handlingAndAgencyComplete != null ? "Every component has governed provenance" : "NOT SOURCED until both components are evidenced"} />
        <SummaryTile label="Canal & strait transits" value="NOT SOURCED" note="No approved transit tariff is connected" tone="open" />
        <SummaryTile label="Port cost and transits, all in" value={money(result?.totals.allInComplete ?? null, result?.displayCurrency ?? "USD")} note={result ? `${money(result.totals.allInKnown, result.displayCurrency)} known · ${result.notSourced.length} items open` : "Complete both port selections"} tone="dark" />
      </div>
    </section>
  );
}

function SummaryTile({ label, value, note, tone }: { label: string; value: string; note: string; tone?: "open" | "dark" }) {
  return <article className={`pda-summary-tile ${tone ? `is-${tone}` : ""}`}><span>{label}</span><strong>{value}</strong><p>{note}</p></article>;
}

function TimelinePanel(props: {
  result: PdaRoutePreviewResult | null;
  etaLoad: string; onEtaLoad: (value: string) => void;
  loadTurn: string; onLoadTurn: (value: string) => void;
  loadRate: string; onLoadRate: (value: string) => void;
  passageDistance: string; onPassageDistance: (value: string) => void;
  passageSpeed: string; onPassageSpeed: (value: string) => void;
  suggestedSpeed: number | null;
  dailyOpex: string; onDailyOpex: (value: string) => void;
  dischargeTurn: string; onDischargeTurn: (value: string) => void;
  dischargeRate: string; onDischargeRate: (value: string) => void;
  loadName: string; dischargeName: string;
}) {
  const timeline = props.result?.timeline;
  return (
    <section className="pda-timeline asb-card">
      <div className="pda-timeline__head"><h2>Voyage timeline</h2><span>{props.loadName} → {props.dischargeName}</span></div>
      <div className="pda-timeline__milestones" aria-label="Voyage milestones">
        <span><Anchor size={15} /> ETA · NOR {props.loadName}<b>{formatUtcTimelineInstant(timeline?.etaLoad)}</b></span>
        <span><Ship size={15} /> ETD {props.loadName}<b>{formatUtcTimelineInstant(timeline?.etdLoad)}</b></span>
        <span><Anchor size={15} /> ETA · NOR {props.dischargeName}<b>{formatUtcTimelineInstant(timeline?.etaDischarge)}</b></span>
        <span><CalendarDays size={15} /> ETD · Open<b>{formatUtcTimelineInstant(timeline?.etdDischarge)}</b></span>
      </div>
      <div className="pda-timeline__track">
        <span className="is-turn">Turn {compactNumber(timeline?.loadTurnDays ?? numberFromText(props.loadTurn), "d")}</span>
        <span className="is-work">Loading {compactNumber(timeline?.loadWorkingDays ?? null, "d")}</span>
        <span className="is-sea">Passage {timeline?.passageDays == null ? "not set" : compactNumber(timeline.passageDays, "d")}</span>
        <span className="is-turn">Turn {compactNumber(timeline?.dischargeTurnDays ?? numberFromText(props.dischargeTurn), "d")}</span>
        <span className="is-work">Discharge {compactNumber(timeline?.dischargeWorkingDays ?? null, "d")}</span>
      </div>
      {!props.etaLoad ? <p className="pda-timeline__hint">Type the UTC ETA at {props.loadName} to put the voyage on the calendar.</p> : null}
      <div className="pda-timeline__inputs">
        <fieldset><legend>{props.loadName}</legend><label>ETA (UTC)<input className="asb-control" type="datetime-local" required value={props.etaLoad} onChange={(event) => props.onEtaLoad(event.target.value)} /></label><label>Load<input className="asb-control" inputMode="decimal" required placeholder="MT/day" value={props.loadRate} onChange={(event) => props.onLoadRate(event.target.value)} /><span>MT/day</span></label><label>Turn<input className="asb-control" inputMode="decimal" required placeholder="days" value={props.loadTurn} onChange={(event) => props.onLoadTurn(event.target.value)} /><span>days</span></label></fieldset>
        <fieldset><legend>Passage</legend><label>Distance<input className="asb-control" inputMode="decimal" required placeholder="nm" value={props.passageDistance} onChange={(event) => props.onPassageDistance(event.target.value)} /></label><label>Speed<input className="asb-control" inputMode="decimal" required placeholder={props.suggestedSpeed == null ? "kn" : `${props.suggestedSpeed} kn on vessel record`} value={props.passageSpeed} onChange={(event) => props.onPassageSpeed(event.target.value)} /></label><label>Daily OPEX<input className="asb-control" inputMode="decimal" placeholder="USD/day (optional)" value={props.dailyOpex} onChange={(event) => props.onDailyOpex(event.target.value)} /></label></fieldset>
        <fieldset><legend>{props.dischargeName}</legend><label>Discharge<input className="asb-control" inputMode="decimal" required placeholder="MT/day" value={props.dischargeRate} onChange={(event) => props.onDischargeRate(event.target.value)} /><span>MT/day</span></label><label>Turn<input className="asb-control" inputMode="decimal" required placeholder="days" value={props.dischargeTurn} onChange={(event) => props.onDischargeTurn(event.target.value)} /><span>days</span></label></fieldset>
      </div>
    </section>
  );
}

function PortEstimateCard({
  side,
  port,
  locode,
  terminals,
  terminalId,
  onTerminal,
  days,
  result,
  displayTotal,
  knownSubtotal,
  displayCurrency,
  notSourced,
  fx,
  manualLines,
  onAddManualLine,
  onUpdateManualLine,
  onRemoveManualLine,
  busy,
}: {
  side: "load" | "discharge";
  port: PdaEstimatorBootstrap["catalog"]["ports"][number] | null;
  locode: string;
  terminals: PdaTerminalItem[];
  terminalId: string;
  onTerminal: (value: string) => void;
  days: number | null;
  result: PdaRoutePreviewResult["legs"]["load"] | null;
  displayTotal: number | null;
  knownSubtotal: number | null;
  displayCurrency: string;
  notSourced: PdaRouteNotSourcedItem[];
  fx: PdaRouteFxRate | null;
  manualLines: ManualQuoteDraft[];
  onAddManualLine: () => void;
  onUpdateManualLine: (id: string, field: Exclude<keyof ManualQuoteDraft, "id">, value: string) => void;
  onRemoveManualLine: (id: string) => void;
  busy: boolean;
}) {
  const warnings = result?.warnings.length ?? 0;
  const manual = result?.warnings.filter((warning) => warning.code === "MANUAL_QUOTE_REQUIRED").length ?? 0;
  const componentNotSourced = notSourced.filter((item) => (
    item.provenance.requestedService === "cargo_handling"
    || item.provenance.requestedService === "agency"
  ));
  const totalProvenance = !result
    ? "Waiting for explicit inputs"
    : displayTotal != null
      ? `${money(result.totals.native, result.nativeCurrency)} native sourced total`
      : result.lines.length
        ? `${money(result.totals.native, result.nativeCurrency)} native known subtotal · total incomplete`
        : "NOT SOURCED · no governed priced lines";
  return (
    <article className="pda-port-card asb-card">
      <header>
        <div><span className="pda-port-card__tag">{side === "load" ? "Load port" : "Discharge port"}</span><h2>{port?.name ?? "Port open"}</h2><p>{locode || "No exact port selected"} · {port?.country ?? ""}</p></div>
        <div className="pda-port-card__total">{busy ? <Loader2 className="is-spinning" size={18} /> : <strong>{money(displayTotal, displayCurrency)}</strong>}<span>{totalProvenance}{displayTotal == null && knownSubtotal != null ? ` · ${money(knownSubtotal, displayCurrency)} display subtotal` : ""}</span>{fx && <small className="pda-port-card__fx">Converted at 1 {fx.base} = {fx.rate} {fx.quote} · {fx.sourceRef} ({fx.sourceKind.replace("_", " ")}), effective {fx.effectiveOn}{fx.inverse ? " · inverse of the recorded pair" : ""}</small>}</div>
      </header>
      <div className="pda-port-card__facts">
        <div><span>Days of stay</span><strong>{compactNumber(days, " d")}</strong></div>
        <label><span>Terminal / agent</span><select className="asb-control" value={terminalId} onChange={(event) => onTerminal(event.target.value)}><option value="">Port-wide / not specified</option>{terminals.map((terminal) => <option key={terminal.id} value={terminal.id}>{terminal.name}</option>)}</select></label>
      </div>
      <ManualQuotesEditor
        side={side}
        lines={manualLines}
        onAdd={onAddManualLine}
        onUpdate={onUpdateManualLine}
        onRemove={onRemoveManualLine}
      />
      <details className="pda-port-card__handling"><summary><ChevronRight size={14} /> Cargo handling & agency <span>{componentNotSourced.length ? "NOT SOURCED" : result ? "governed evidence found" : "awaiting preview"}</span></summary><p>Handling and agency figures appear only when backed by an applicable published line or an attributed quotation.</p>{componentNotSourced.map((item) => <aside key={item.code}><strong>NOT SOURCED · {item.label}</strong><span>{item.message}</span><small>{item.provenance.tariffVersionId ? `Tariff version ${item.provenance.tariffVersionId}` : "No published tariff provenance"}</small></aside>)}</details>
      <details className="pda-port-card__breakdown">
        <summary><ChevronRight size={14} /> Breakdown · {result?.lines.length ?? 0} charges <span>{!result ? "awaiting explicit inputs" : manual ? `${manual} agent quote${manual === 1 ? "" : "s"} required` : warnings ? `${warnings} note${warnings === 1 ? "" : "s"}` : "governed tariff"}</span></summary>
        <div>
          {result?.lines.length ? result.lines.map((line, index) => (
            <article className="pda-breakdown-line" key={`${line.ruleCode ?? "line"}-${index}`}>
              <p><span>{line.label}{line.manual ? <em>manual</em> : null}</span><strong>{money(line.amount, result.nativeCurrency)}</strong></p>
              <p className="pda-breakdown-line__explanation">{line.explanation}</p>
              {line.manual ? <p className="pda-breakdown-line__provenance"><b>Manual attribution:</b> {line.enteredBy ?? "Attributed member"}{line.manualReason ? ` · ${line.manualReason}` : ""}</p> : null}
              {line.evidence.title ? (
                <p className="pda-breakdown-line__provenance"><b>Evidence:</b> {line.evidence.title}{line.evidence.page ? ` · page ${line.evidence.page}` : ""}{line.evidence.sheet ? ` · sheet ${line.evidence.sheet}` : ""}{line.evidence.sourceId ? ` · source ${line.evidence.sourceId}` : ""}{line.evidence.excerpt ? ` · ${line.evidence.excerpt}` : ""}</p>
              ) : line.manual ? (
                <p className="pda-breakdown-line__provenance"><b>Evidence:</b> attributed manual quotation; no tariff document attached.</p>
              ) : null}
            </article>
          )) : <p><span>No priced tariff lines</span><strong>NOT SOURCED</strong></p>}
          {notSourced.filter((item) => !componentNotSourced.includes(item)).map((item) => <aside className="pda-not-sourced-line" key={item.code}><strong>NOT SOURCED · {item.label}</strong><span>{item.message}</span><small>{item.provenance.tariffVersionId ? `Tariff version ${item.provenance.tariffVersionId}` : "No published tariff provenance"}{item.provenance.warningCode ? ` · ${item.provenance.warningCode}` : ""}{item.provenance.ruleCode ? ` · rule ${item.provenance.ruleCode}` : ""}</small></aside>)}
          {result?.warnings.map((warning, index) => <aside key={`${warning.code}-${index}`}>{warning.message}</aside>)}
        </div>
      </details>
      <footer><a href="/admin/port-tariffs">Port record</a><a href="/admin/port-tariffs">Port settings</a><span>{!result ? "Waiting for explicit inputs" : <>{result.tariffVersionId ? `Tariff ${result.tariffVersionId} · ` : "No tariff version · "}{warnings || notSourced.length ? `${warnings + notSourced.length} item${warnings + notSourced.length === 1 ? "" : "s"} need attention` : "All sourced lines shown"}</>}</span></footer>
    </article>
  );
}

function ManualQuotesEditor({
  side,
  lines,
  onAdd,
  onUpdate,
  onRemove,
}: {
  side: "load" | "discharge";
  lines: ManualQuoteDraft[];
  onAdd: () => void;
  onUpdate: (id: string, field: Exclude<keyof ManualQuoteDraft, "id">, value: string) => void;
  onRemove: (id: string) => void;
}) {
  const legLabel = side === "load" ? "Load port" : "Discharge port";
  return (
    <section className="pda-manual-quotes" aria-label={`${legLabel} attributed manual quotations`}>
      <header>
        <div>
          <strong>Attributed manual quotations</strong>
          <span>Server-attributed; applied only within an effective published tariff and currency.</span>
        </div>
        <button type="button" className="asb-button" onClick={onAdd}><Plus size={12} /> Add quote</button>
      </header>
      {lines.map((line, index) => {
        const idPrefix = `pda-${side}-manual-${line.id}`;
        return (
          <fieldset key={line.id} className="pda-manual-quotes__line">
            <legend>{legLabel} quote {index + 1}</legend>
            <label htmlFor={`${idPrefix}-rule`}>Rule code <span>optional</span></label>
            <input
              id={`${idPrefix}-rule`}
              className="asb-control"
              maxLength={80}
              placeholder="e.g. towage"
              value={line.ruleCode}
              onChange={(event) => onUpdate(line.id, "ruleCode", event.target.value)}
            />
            <label htmlFor={`${idPrefix}-label`}>Quote label</label>
            <input
              id={`${idPrefix}-label`}
              className="asb-control"
              maxLength={200}
              placeholder="Agent towage quote"
              value={line.label}
              onChange={(event) => onUpdate(line.id, "label", event.target.value)}
            />
            <label htmlFor={`${idPrefix}-amount`}>Amount</label>
            <input
              id={`${idPrefix}-amount`}
              className="asb-control"
              inputMode="decimal"
              placeholder="0.00"
              value={line.amount}
              onChange={(event) => onUpdate(line.id, "amount", event.target.value)}
            />
            <label htmlFor={`${idPrefix}-reason`}>Quote reason / reference</label>
            <input
              id={`${idPrefix}-reason`}
              className="asb-control"
              maxLength={500}
              placeholder="Agent email Q-123"
              value={line.reason}
              onChange={(event) => onUpdate(line.id, "reason", event.target.value)}
            />
            <button type="button" aria-label={`Remove ${legLabel.toLowerCase()} quote ${index + 1}`} onClick={() => onRemove(line.id)}><X size={13} /></button>
          </fieldset>
        );
      })}
    </section>
  );
}
