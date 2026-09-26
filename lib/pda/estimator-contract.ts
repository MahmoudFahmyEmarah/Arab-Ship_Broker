import type { CargoView, VesselView } from "@/lib/portal/types";

export type PdaEstimatorTab = "estimate" | "ports" | "agents" | "setup";
export type PdaEstimatorDensity = "compact" | "comfortable";
export type PdaAllocation = "vessel" | "charterer";

export interface PdaEstimatorPortOption {
  locode: string;
  name: string;
  country: string;
}

export interface PdaEstimatorVesselOption {
  id: string;
  vesselId: string | null;
  name: string;
  imo: string;
  type: string;
  dwt: string;
  gt: number | null;
  scnrt: number | null;
  loaM: number | null;
  serviceSpeed: number | null;
}

export type PdaRoutePortScope = "port" | "options" | "area" | "none" | null;

export interface PdaEstimatorCargoOption {
  id: string;
  refId: string;
  cargo: string;
  commodity: string;
  type: string;
  quantityMinMt: number | null;
  quantityMaxMt: number | null;
  quantityLabel: string;
  loadRateMtPerDay: number | null;
  dischargeRateMtPerDay: number | null;
  loadPort: {
    locode: string | null;
    name: string;
    scope: PdaRoutePortScope;
  };
  dischargePort: {
    locode: string | null;
    name: string;
    scope: PdaRoutePortScope;
  };
}

export interface PdaEstimatorCatalog {
  vessels: PdaEstimatorVesselOption[];
  cargos: PdaEstimatorCargoOption[];
  ports: PdaEstimatorPortOption[];
}

export interface PdaEstimatorHandoff {
  from: "fixture" | null;
  ref: string | null;
  cargoId: string | null;
  vesselId: string | null;
  vesselName: string | null;
  loadPortLocode: string | null;
  dischargePortLocode: string | null;
  quantityMt: number | null;
  supplied: boolean;
}

export type PdaEstimatorNoticeCode =
  | "HANDOFF_SOURCE_IGNORED"
  | "HANDOFF_CARGO_NOT_FOUND"
  | "HANDOFF_VESSEL_NOT_FOUND"
  | "HANDOFF_VESSEL_AMBIGUOUS"
  | "HANDOFF_LOAD_PORT_NOT_FOUND"
  | "HANDOFF_DISCHARGE_PORT_NOT_FOUND"
  | "HANDOFF_QUANTITY_INVALID"
  | "CARGO_LOAD_PORT_NEEDS_CHOICE"
  | "CARGO_DISCHARGE_PORT_NEEDS_CHOICE";

export interface PdaEstimatorNotice {
  code: PdaEstimatorNoticeCode;
  message: string;
}

export interface PdaEstimatorInitialSelection {
  vesselId: string | null;
  cargoId: string | null;
  loadPortLocode: string | null;
  dischargePortLocode: string | null;
  quantityMt: number | null;
  allocation: PdaAllocation;
  density: PdaEstimatorDensity;
  from: "fixture" | null;
  ref: string | null;
}

export interface PdaEstimatorBootstrap {
  catalog: PdaEstimatorCatalog;
  initial: PdaEstimatorInitialSelection;
  notices: PdaEstimatorNotice[];
}

export type PdaEstimatorSearchParams = Record<string, string | string[] | undefined>;

const LOCODE = /^[A-Z]{2}[A-Z0-9]{3}$/;
const MAX_REFERENCE_LENGTH = 100;
const MAX_NAME_LENGTH = 120;

function first(value: string | string[] | undefined): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  const trimmed = candidate?.trim() ?? "";
  return trimmed || null;
}

function bounded(value: string | null, max: number): string | null {
  return value && value.length <= max ? value : null;
}

function locode(value: string | null): string | null {
  const normalized = value?.replace(/\s+/g, "").toUpperCase() ?? "";
  return LOCODE.test(normalized) ? normalized : null;
}

function positiveNumber(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value.replaceAll(",", ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizedCargoPort(
  code: string,
  name: string,
  scope: PdaRoutePortScope | undefined,
): PdaEstimatorCargoOption["loadPort"] {
  return {
    locode: locode(code),
    name: name.trim() || "Port not set",
    scope: scope ?? null,
  };
}

export function buildPdaEstimatorCatalog(input: {
  vessels: VesselView[];
  cargos: CargoView[];
  ports: PdaEstimatorPortOption[];
}): PdaEstimatorCatalog {
  return {
    vessels: input.vessels.map((vessel) => ({
      id: vessel.id,
      vesselId: vessel.vesselId ?? null,
      name: vessel.name,
      imo: vessel.imo,
      type: vessel.type,
      dwt: vessel.dwt,
      gt: vessel.gt ?? null,
      scnrt: vessel.scnrt ?? null,
      loaM: vessel.loaM ?? null,
      serviceSpeed: vessel.serviceSpeed ?? null,
    })),
    cargos: input.cargos.map((cargo) => ({
      id: cargo.id,
      refId: cargo.refId,
      cargo: cargo.cargo,
      commodity: cargo.commodity,
      type: cargo.type,
      quantityMinMt: cargo.qty.min,
      quantityMaxMt: cargo.qty.max,
      quantityLabel: cargo.qtyMt,
      loadRateMtPerDay: cargo.loadRate,
      dischargeRateMtPerDay: cargo.dischRate,
      loadPort: normalizedCargoPort(
        cargo.route.polCode,
        cargo.route.polName,
        cargo.portScope?.polScope,
      ),
      dischargePort: normalizedCargoPort(
        cargo.route.podCode,
        cargo.route.podName,
        cargo.portScope?.podScope,
      ),
    })),
    ports: input.ports.map((port) => ({
      ...port,
      locode: port.locode.replace(/\s+/g, "").toUpperCase(),
    })),
  };
}

export function parsePdaEstimatorHandoff(
  params: PdaEstimatorSearchParams,
): PdaEstimatorHandoff {
  const rawFrom = first(params.from)?.toLowerCase() ?? null;
  const rawQuantity = first(params.mt);
  return {
    from: rawFrom === "fixture" ? "fixture" : null,
    ref: bounded(first(params.ref), MAX_REFERENCE_LENGTH),
    cargoId: bounded(first(params.cargoId), MAX_REFERENCE_LENGTH),
    vesselId: bounded(first(params.vesselId), MAX_REFERENCE_LENGTH),
    vesselName: bounded(first(params.vessel), MAX_NAME_LENGTH),
    loadPortLocode: locode(first(params.load)),
    dischargePortLocode: locode(first(params.disch)),
    quantityMt: positiveNumber(rawQuantity),
    supplied: ["from", "ref", "cargoId", "vesselId", "vessel", "load", "disch", "mt"]
      .some((key) => first(params[key]) != null),
  };
}

export function resolvePdaEstimatorBootstrap(
  catalog: PdaEstimatorCatalog,
  params: PdaEstimatorSearchParams,
): PdaEstimatorBootstrap {
  const handoff = parsePdaEstimatorHandoff(params);
  const notices: PdaEstimatorNotice[] = [];
  const rawFrom = first(params.from);

  if (rawFrom && !handoff.from) {
    notices.push({
      code: "HANDOFF_SOURCE_IGNORED",
      message: "The hand-off source is not supported, so no external context was applied.",
    });
  }

  const cargo = handoff.cargoId
    ? catalog.cargos.find((item) => item.id === handoff.cargoId || item.refId === handoff.cargoId) ?? null
    : null;
  if (handoff.cargoId && !cargo) {
    notices.push({
      code: "HANDOFF_CARGO_NOT_FOUND",
      message: "The linked cargo is not available to this account. Choose an authorised cargo.",
    });
  }

  let vessel = handoff.vesselId
    ? catalog.vessels.find((item) => item.id === handoff.vesselId || item.vesselId === handoff.vesselId) ?? null
    : null;
  if (handoff.vesselId && !vessel) {
    notices.push({
      code: "HANDOFF_VESSEL_NOT_FOUND",
      message: "The linked vessel is not available to this account. Choose an authorised vessel.",
    });
  }

  if (!vessel && !handoff.vesselId && handoff.vesselName) {
    const nameMatches = catalog.vessels.filter(
      (item) => item.name.localeCompare(handoff.vesselName!, undefined, { sensitivity: "accent" }) === 0,
    );
    if (nameMatches.length === 1) vessel = nameMatches[0]!;
    else if (nameMatches.length > 1) {
      notices.push({
        code: "HANDOFF_VESSEL_AMBIGUOUS",
        message: "More than one authorised vessel has that name. Choose the intended vessel.",
      });
    } else {
      notices.push({
        code: "HANDOFF_VESSEL_NOT_FOUND",
        message: "The named vessel is not available to this account. Choose an authorised vessel.",
      });
    }
  }

  const knownPorts = new Set(catalog.ports.map((port) => port.locode));
  const rawLoad = first(params.load);
  const rawDischarge = first(params.disch);
  const rawQuantity = first(params.mt);

  const requestedLoad = handoff.loadPortLocode && knownPorts.has(handoff.loadPortLocode)
    ? handoff.loadPortLocode
    : null;
  if (rawLoad && !requestedLoad) {
    notices.push({
      code: "HANDOFF_LOAD_PORT_NOT_FOUND",
      message: "The linked load port is invalid or unavailable. Confirm the load port before calculating.",
    });
  }

  const requestedDischarge = handoff.dischargePortLocode && knownPorts.has(handoff.dischargePortLocode)
    ? handoff.dischargePortLocode
    : null;
  if (rawDischarge && !requestedDischarge) {
    notices.push({
      code: "HANDOFF_DISCHARGE_PORT_NOT_FOUND",
      message: "The linked discharge port is invalid or unavailable. Confirm the discharge port before calculating.",
    });
  }

  if (rawQuantity && handoff.quantityMt == null) {
    notices.push({
      code: "HANDOFF_QUANTITY_INVALID",
      message: "The linked cargo quantity is invalid. Confirm the quantity before calculating.",
    });
  }

  const cargoLoad = cargo?.loadPort.locode && knownPorts.has(cargo.loadPort.locode)
    ? cargo.loadPort.locode
    : null;
  const cargoDischarge = cargo?.dischargePort.locode && knownPorts.has(cargo.dischargePort.locode)
    ? cargo.dischargePort.locode
    : null;

  if (cargo && !requestedLoad && cargo.loadPort.scope !== "port") {
    notices.push({
      code: "CARGO_LOAD_PORT_NEEDS_CHOICE",
      message: "This cargo has a load range or area. Choose the exact load port before calculating.",
    });
  }
  if (cargo && !requestedDischarge && cargo.dischargePort.scope !== "port") {
    notices.push({
      code: "CARGO_DISCHARGE_PORT_NEEDS_CHOICE",
      message: "This cargo has a discharge range or area. Choose the exact discharge port before calculating.",
    });
  }

  return {
    catalog,
    initial: {
      vesselId: vessel?.id ?? null,
      cargoId: cargo?.id ?? null,
      loadPortLocode: requestedLoad ?? cargoLoad,
      dischargePortLocode: requestedDischarge ?? cargoDischarge,
      quantityMt: handoff.quantityMt ?? cargo?.quantityMaxMt ?? cargo?.quantityMinMt ?? null,
      allocation: "vessel",
      density: "compact",
      from: handoff.from,
      ref: handoff.ref,
    },
    notices,
  };
}
