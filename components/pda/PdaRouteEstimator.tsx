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
import type { PdaRoutePreviewInput, PdaRoutePreviewResult } from "@/lib/pda/route-types";
import type { PdaRequest } from "@/lib/pda/types";
import type { PdaCoverageItem, PdaTerminalItem } from "@/sdk/app/pda";

import "@/components/design-system/asb-ds.css";
import "./pda-route-estimator.css";

interface Props {
  bootstrap: PdaEstimatorBootstrap;
  coverage: PdaCoverageItem[];
  terminals: PdaTerminalItem[];
}

const REQUESTED_SERVICES = [
  "port_dues",
  "pilotage",
  "towage",
  "mooring",
  "agency",
  "waste",
  "security",
  "launch",
];

const TABS: Array<{ id: PdaEstimatorTab; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { id: "estimate", label: "Estimate", icon: Ship },
  { id: "ports", label: "Ports", icon: Map },
  { id: "agents", label: "Agents", icon: UserRound },
  { id: "setup", label: "Setup", icon: Settings2 },
];

const today = () => new Date().toISOString().slice(0, 10);

function numberFromText(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value.replaceAll(",", ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function positiveOr(value: string, fallback: number): number {
  const parsed = numberFromText(value);
  return parsed != null && parsed > 0 ? parsed : fallback;
}

function dateTimeIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
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

function legRequest(input: {
  portLocode: string;
  terminalId: string;
  vessel: PdaEstimatorVesselOption;
  cargo: PdaEstimatorCargoOption;
  quantityMt: number;
  callDate: string;
  displayCurrency: string;
}): PdaRequest {
  return {
    portLocode: input.portLocode,
    terminalId: input.terminalId || null,
    callDate: input.callDate,
    vessel: {
      vesselId: input.vessel.vesselId,
      vesselName: input.vessel.name,
      imo: input.vessel.imo,
      vesselType: input.vessel.type,
      gt: input.vessel.gt,
      scnrt: input.vessel.scnrt,
      dwt: numberFromText(input.vessel.dwt),
      loaM: input.vessel.loaM,
    },
    call: {
      days: 1,
      cargoQuantityMt: input.quantityMt,
      cargoType: input.cargo.type,
      cargoStatus: "laden",
      voyageScope: "international",
      location: "alongside",
      requestedServices: REQUESTED_SERVICES,
    },
    convertedCurrency: input.displayCurrency,
    fxRate: null,
    manualLines: [],
  };
}

export function PdaRouteEstimator({ bootstrap, terminals }: Props) {
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
  const [loadTurn, setLoadTurn] = React.useState("1");
  const [dischargeTurn, setDischargeTurn] = React.useState("1");
  const [loadRate, setLoadRate] = React.useState("1200");
  const [dischargeRate, setDischargeRate] = React.useState("1200");
  const [passageDistance, setPassageDistance] = React.useState("");
  const [passageSpeed, setPassageSpeed] = React.useState("");
  const [dailyOpex, setDailyOpex] = React.useState("");
  const [loadTerminal, setLoadTerminal] = React.useState("");
  const [dischargeTerminal, setDischargeTerminal] = React.useState("");
  const [result, setResult] = React.useState<PdaRoutePreviewResult | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const requestSequence = React.useRef(0);

  const vessel = bootstrap.catalog.vessels.find((item) => item.id === vesselId) ?? null;
  const cargo = bootstrap.catalog.cargos.find((item) => item.id === cargoId) ?? null;
  const quantityMt = numberFromText(quantity);
  const loadPortRecord = bootstrap.catalog.ports.find((item) => item.locode === loadPort) ?? null;
  const dischargePortRecord = bootstrap.catalog.ports.find((item) => item.locode === dischargePort) ?? null;
  const loadTerminals = terminals.filter((item) => item.portLocode === loadPort);
  const dischargeTerminals = terminals.filter((item) => item.portLocode === dischargePort);
  const selected = Boolean(vessel && cargo);
  const ready = Boolean(
    selected
    && quantityMt != null
    && quantityMt > 0
    && loadPortRecord
    && dischargePortRecord
    && bootstrap.catalogState === "ready",
  );

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
    if (!ready || !vessel || !cargo || quantityMt == null) {
      setBusy(false);
      return;
    }

    const eta = dateTimeIso(etaLoad);
    const callDate = eta?.slice(0, 10) ?? today();
    const loadRequest = legRequest({
      portLocode: loadPort,
      terminalId: loadTerminal,
      vessel,
      cargo,
      quantityMt,
      callDate,
      displayCurrency: "USD",
    });
    const dischargeRequest = legRequest({
      portLocode: dischargePort,
      terminalId: dischargeTerminal,
      vessel,
      cargo,
      quantityMt,
      callDate,
      displayCurrency: "USD",
    });
    const distanceNm = numberFromText(passageDistance);
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
        etaLoad: eta,
        loadTurnDays: positiveOr(loadTurn, 0),
        loadProductivityMtPerDay: positiveOr(loadRate, 1200),
        passageDistanceNm: distanceNm,
        passageSpeedKnots: distanceNm == null ? null : numberFromText(passageSpeed) || vessel.serviceSpeed,
        dischargeTurnDays: positiveOr(dischargeTurn, 0),
        dischargeProductivityMtPerDay: positiveOr(dischargeRate, 1200),
        dailyOpex: numberFromText(dailyOpex),
      },
    };

    setBusy(true);
    const timer = window.setTimeout(async () => {
      const response = await previewPdaRoute(input);
      if (requestSequence.current !== sequence) return;
      if (response.ok) setResult(response.data);
      else setError(response.error);
      setBusy(false);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [
    allocation,
    cargo,
    dailyOpex,
    dischargePort,
    dischargeRate,
    dischargeTerminal,
    dischargeTurn,
    etaLoad,
    loadPort,
    loadRate,
    loadTerminal,
    loadTurn,
    passageDistance,
    passageSpeed,
    quantityMt,
    ready,
    vessel,
  ]);

  function reset() {
    ++requestSequence.current;
    setVesselId("");
    setCargoId("");
    setLoadPort("");
    setDischargePort("");
    setQuantity("");
    setEtaLoad("");
    setResult(null);
    setError("");
    setBusy(false);
  }

  function chooseCargo(nextId: string) {
    const nextCargo = bootstrap.catalog.cargos.find((item) => item.id === nextId) ?? null;
    setCargoId(nextId);
    if (!nextCargo) return;
    setQuantity(String(nextCargo.quantityMaxMt ?? nextCargo.quantityMinMt ?? ""));
    setLoadPort(nextCargo.loadPort.scope === "port" ? nextCargo.loadPort.locode ?? "" : "");
    setDischargePort(nextCargo.dischargePort.scope === "port" ? nextCargo.dischargePort.locode ?? "" : "");
    setLoadRate(String(nextCargo.loadRateMtPerDay ?? 1200));
    setDischargeRate(String(nextCargo.dischargeRateMtPerDay ?? 1200));
    setLoadTerminal("");
    setDischargeTerminal("");
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
                  displayCurrency={result?.displayCurrency ?? "USD"}
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
                  displayCurrency={result?.displayCurrency ?? "USD"}
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
          aria-activedescendant={activeIndex >= 0 ? `pda-${kind}-option-${filtered[activeIndex]?.id}` : undefined}
          onFocus={() => { setQuery(""); setOpen(true); setActiveIndex(-1); }}
          onBlur={() => window.setTimeout(() => { setOpen(false); setActiveIndex(-1); }, 120)}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); setActiveIndex(-1); }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((index) => Math.min(index + 1, filtered.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
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
        <SummaryTile label="Both ports · excl. handling" value={money(known, result?.displayCurrency ?? "USD")} note={result ? `POL ${money(result.totals.loadPort, result.displayCurrency)} · POD ${money(result.totals.dischargePort, result.displayCurrency)}` : "Governed port tariffs"} />
        <SummaryTile label="Both ports · incl. handling & agency" value={money(known, result?.displayCurrency ?? "USD")} note="Only sourced amounts are included" />
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
        <span><Anchor size={15} /> ETA · NOR {props.loadName}<b>{timeline?.etaLoad ? new Date(timeline.etaLoad).toLocaleString() : "—"}</b></span>
        <span><Ship size={15} /> ETD {props.loadName}<b>{timeline?.etdLoad ? new Date(timeline.etdLoad).toLocaleString() : "—"}</b></span>
        <span><Anchor size={15} /> ETA · NOR {props.dischargeName}<b>{timeline?.etaDischarge ? new Date(timeline.etaDischarge).toLocaleString() : "—"}</b></span>
        <span><CalendarDays size={15} /> ETD · Open<b>{timeline?.etdDischarge ? new Date(timeline.etdDischarge).toLocaleString() : "—"}</b></span>
      </div>
      <div className="pda-timeline__track">
        <span className="is-turn">Turn {compactNumber(timeline?.loadTurnDays ?? numberFromText(props.loadTurn), "d")}</span>
        <span className="is-work">Loading {compactNumber(timeline?.loadWorkingDays ?? null, "d")}</span>
        <span className="is-sea">Passage {timeline?.passageDays == null ? "not set" : compactNumber(timeline.passageDays, "d")}</span>
        <span className="is-turn">Turn {compactNumber(timeline?.dischargeTurnDays ?? numberFromText(props.dischargeTurn), "d")}</span>
        <span className="is-work">Discharge {compactNumber(timeline?.dischargeWorkingDays ?? null, "d")}</span>
      </div>
      {!props.etaLoad ? <p className="pda-timeline__hint">Type the ETA at {props.loadName} to put the voyage on the calendar.</p> : null}
      <div className="pda-timeline__inputs">
        <fieldset><legend>{props.loadName}</legend><label>ETA<input className="asb-control" type="datetime-local" value={props.etaLoad} onChange={(event) => props.onEtaLoad(event.target.value)} /></label><label>Load<input className="asb-control" inputMode="decimal" value={props.loadRate} onChange={(event) => props.onLoadRate(event.target.value)} /><span>MT/day</span></label><label>Turn<input className="asb-control" inputMode="decimal" value={props.loadTurn} onChange={(event) => props.onLoadTurn(event.target.value)} /><span>days</span></label></fieldset>
        <fieldset><legend>Passage</legend><label>Distance<input className="asb-control" inputMode="decimal" placeholder="nm" value={props.passageDistance} onChange={(event) => props.onPassageDistance(event.target.value)} /></label><label>Speed<input className="asb-control" inputMode="decimal" placeholder="kn" value={props.passageSpeed} onChange={(event) => props.onPassageSpeed(event.target.value)} /></label><label>Daily OPEX<input className="asb-control" inputMode="decimal" placeholder="USD/day" value={props.dailyOpex} onChange={(event) => props.onDailyOpex(event.target.value)} /></label></fieldset>
        <fieldset><legend>{props.dischargeName}</legend><label>Discharge<input className="asb-control" inputMode="decimal" value={props.dischargeRate} onChange={(event) => props.onDischargeRate(event.target.value)} /><span>MT/day</span></label><label>Turn<input className="asb-control" inputMode="decimal" value={props.dischargeTurn} onChange={(event) => props.onDischargeTurn(event.target.value)} /><span>days</span></label></fieldset>
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
  displayCurrency,
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
  displayCurrency: string;
  busy: boolean;
}) {
  const warnings = result?.warnings.length ?? 0;
  const manual = result?.warnings.filter((warning) => warning.code === "MANUAL_QUOTE_REQUIRED").length ?? 0;
  return (
    <article className="pda-port-card asb-card">
      <header>
        <div><span className="pda-port-card__tag">{side === "load" ? "Load port" : "Discharge port"}</span><h2>{port?.name ?? "Port open"}</h2><p>{locode || "No exact port selected"} · {port?.country ?? ""}</p></div>
        <div className="pda-port-card__total">{busy ? <Loader2 className="is-spinning" size={18} /> : <strong>{money(displayTotal, displayCurrency)}</strong>}<span>{result ? `${money(result.totals.native, result.nativeCurrency)} native` : "Waiting for governed result"}</span></div>
      </header>
      <div className="pda-port-card__facts">
        <div><span>Days of stay</span><strong>{compactNumber(days, " d")}</strong></div>
        <label><span>Terminal / agent</span><select className="asb-control" value={terminalId} onChange={(event) => onTerminal(event.target.value)}><option value="">Port-wide / not specified</option>{terminals.map((terminal) => <option key={terminal.id} value={terminal.id}>{terminal.name}</option>)}</select></label>
      </div>
      <details className="pda-port-card__handling"><summary><ChevronRight size={14} /> Cargo handling <span>not sourced unless included in tariff</span></summary><p>Handling and agency figures appear only when backed by a published tariff or an attributed quotation.</p></details>
      <details className="pda-port-card__breakdown">
        <summary><ChevronRight size={14} /> Breakdown · {result?.lines.length ?? 0} charges <span>{manual ? `${manual} agent quote${manual === 1 ? "" : "s"} required` : warnings ? `${warnings} note${warnings === 1 ? "" : "s"}` : "governed tariff"}</span></summary>
        <div>
          {result?.lines.length ? result.lines.map((line, index) => <p key={`${line.ruleCode ?? "line"}-${index}`}><span>{line.label}</span><strong>{money(line.amount, result.nativeCurrency)}</strong></p>) : <p><span>No priced tariff lines</span><strong>—</strong></p>}
          {result?.warnings.map((warning, index) => <aside key={`${warning.code}-${index}`}>{warning.message}</aside>)}
        </div>
      </details>
      <footer><a href="/admin/port-tariffs">Port record</a><a href="/admin/port-tariffs">Port settings</a><span>{warnings ? `${warnings} item${warnings === 1 ? "" : "s"} need attention` : "All sourced lines shown"}</span></footer>
    </article>
  );
}
