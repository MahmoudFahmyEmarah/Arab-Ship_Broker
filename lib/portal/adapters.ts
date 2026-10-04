// Adapters: Supabase row types (lib/schemas/*) → portal view models.
// These are the single boundary between the real data layer and the
// Claude-design UI, so wiring a page to live data is just:
//   const rows = await getCargos(supabase, filters);
//   const views = rows.map(toCargoView);

import {
  CargoListingRow,
  ZONE_LABELS,
  FT3LT_TO_M3T,
} from "@/lib/schemas/cargo";
import {
  MyVesselRow,
  VesselAvailabilityWithVessel,
  stripVesselNamePrefix,
} from "@/lib/schemas/vessel";
import { CargoView, VesselView, CargoScope, VesselStatusView } from "./types";
import type {
  MarketCargoRow,
  MarketPosterRow,
  MarketVesselRow,
} from "@/sdk/app/market";

interface OwnedAccess {
  listingKey?: string | null;
  ownedListingId?: string | null;
  isOwned?: boolean;
  canManage?: boolean;
  listingKeyExpiresAt?: string | null;
}

function posterView(poster: MarketPosterRow | null | undefined) {
  if (!poster) return null;
  return {
    name: poster.name,
    company: poster.company,
    kind: poster.kind,
    isAdmin: poster.is_admin,
    orgId: null,
  } as const;
}

function portList(
  v: CargoListingRow["load_ports"],
): { locode: string; name: string; zone: string; status: string }[] | undefined {
  if (!Array.isArray(v) || v.length === 0) return undefined;
  const rows = v
    .filter((p) => p && p.locode)
    .map((p) => ({ locode: p.locode, name: p.name ?? "", zone: p.zone ?? "", status: p.status ?? "" }));
  return rows.length ? rows : undefined;
}

export function daysFromNow(dateStr: string | null, now: Date = new Date()): number | null {
  const targetDay = civilDayOrdinal(dateStr);
  if (targetDay == null || Number.isNaN(now.getTime())) return null;
  const today = Math.trunc(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 86_400_000,
  );
  return targetDay - today;
}

/** UTC civil-day ordinal used by both the SQL and TypeScript matchers. */
function civilDayOrdinal(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const value = Date.UTC(year, month - 1, day);
  const parsed = new Date(value);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) return null;
  return Math.trunc(value / 86_400_000);
}

function scopeFromStatus(status: CargoListingRow["status"]): CargoScope {
  switch (status) {
    case "IN":
      return "in";
    case "PARTIAL":
      return "partial";
    case "OUT":
      return "out";
    case "CLOSED":
      return "fixed";
    default:
      return "in";
  }
}

function imsbcGroup(
  row: Pick<CargoListingRow, "is_dg_cargo" | "is_grain_cargo">,
): string {
  if (row.is_dg_cargo) return "DG";
  if (row.is_grain_cargo) return "A";
  return "C";
}

const numFmt = new Intl.NumberFormat("en-US");

export function toCargoView(
  row: CargoListingRow | MarketCargoRow,
  matches = 0,
  ownedAccess: OwnedAccess = {},
): CargoView {
  // Stowage factor is stored in ft³/LT; the card shows m³/t.
  const sf =
    row.stowage_factor != null
      ? Math.round(row.stowage_factor * FT3LT_TO_M3T * 100) / 100
      : null;

  const market = "listing_key" in row ? row : null;
  const publicId = market?.listing_key ?? row.id;
  const isOwned = market?.is_owned ?? ownedAccess.isOwned ?? false;
  const canManage = market?.can_manage ?? ownedAccess.canManage ?? false;
  return {
    id: publicId,
    listingKey: market?.listing_key ?? ownedAccess.listingKey ?? null,
    ownedListingId:
      market?.owned_listing_id ?? ownedAccess.ownedListingId ?? null,
    isOwned,
    canManage,
    listingKeyExpiresAt:
      market?.expires_at ?? ownedAccess.listingKeyExpiresAt ?? null,
    refId: row.ref ?? publicId.slice(0, 8).toUpperCase(),
    cargo: row.commodity_name,
    commodity: row.commodity_name,
    type: row.cargo_type,
    scope: scopeFromStatus(row.status),
    route: {
      polName: row.load_port_name,
      polCode: row.load_port_locode,
      polZone: ZONE_LABELS[row.load_zone] ? row.load_zone : row.load_zone,
      podName: row.disch_port_name,
      podCode: row.disch_port_locode,
      podZone: row.disch_zone,
    },
    portScope: {
      polScope: row.load_port_scope ?? null,
      podScope: row.disch_port_scope ?? null,
      polRef:
        row.load_ref_locode ??
        ("load_port_2_locode" in row ? row.load_port_2_locode : null) ??
        null,
      podRef:
        row.disch_ref_locode ??
        ("disch_port_2_locode" in row ? row.disch_port_2_locode : null) ??
        null,
    },
    loadPorts: portList(row.load_ports),
    dischPorts: portList(row.disch_ports),
    qty: { min: row.qty_min_mt, max: row.qty_max_mt },
    qtyMt: numFmt.format(row.qty_max_mt),
    vol: row.volume_cbm != null ? numFmt.format(row.volume_cbm) : "—",
    volUnit: "m³",
    sf,
    imsbcGroup: imsbcGroup(row),
    laycanFrom: row.laycan_from ?? "",
    laycanTo: row.laycan_to ?? "",
    laycanDays: daysFromNow(row.laycan_from),
    // Freshness clock — when the listing was posted/last confirmed
    postedAt: (row as { refreshed_at?: string | null }).refreshed_at ?? row.created_at ?? null,
    loadTerms: row.load_terms,
    loadRate: row.load_rate,
    dischRate: row.disch_rate,
    freightIdea: row.freight_idea_usd_mt,
    commission: row.commission_ttl_pct ?? row.commission_pct,
    demurrage: row.demurrage_rate,
    matches: market?.match_count ?? matches,
    spot: row.is_spot,
    forCirculation: row.review_status === "APPROVED",
    partnerSlug: row.broker,
    requiresGeared: row.requires_geared,
    maxAge: row.max_vessel_age_yr,
    maxLoa: row.max_loa_m,
    maxDraft: row.max_draft_m,
    isGrain: row.is_grain_cargo,
    isDg: row.is_dg_cargo,
    matchingFacts: {
      cargoId: publicId,
      reviewStatus: row.review_status,
      status: row.status,
      qtyMinMt: row.qty_min_mt,
      qtyMaxMt: row.qty_max_mt,
      cargoType: row.cargo_type,
      isSpot: row.is_spot,
      laycanFromDay: civilDayOrdinal(row.laycan_from),
      requiresGeared: row.requires_geared,
      isGrainCargo: row.is_grain_cargo,
      isDgCargo: row.is_dg_cargo,
      maxVesselAgeYr: row.max_vessel_age_yr,
      maxDraftM: row.max_draft_m,
      maxLoaM: row.max_loa_m,
      loadZone: row.load_zone,
      dischZone: row.disch_zone,
      freightIdeaUsdMt: row.freight_idea_usd_mt,
    },
    poster: posterView(market?.poster),
  };
}

const meters = (n: number | null | undefined) => (n != null ? `${n} m` : undefined);

function urgencyFromDays(days: number | null): "red" | "amber" | "green" {
  if (days == null) return "green";
  if (days < 0) return "red";
  if (days <= 7) return "amber";
  return "green";
}

export function vesselAge(buildYear: number | null, now: Date = new Date()): number | null {
  if (buildYear == null || Number.isNaN(now.getTime())) return null;
  return now.getUTCFullYear() - buildYear;
}

export function vesselFromAvailability(
  row: VesselAvailabilityWithVessel | MarketVesselRow,
  matches = 0,
  ownedAccess: OwnedAccess = {},
): VesselView {
  const v = row.vessel;
  const days = daysFromNow(row.open_date);
  // Prod stores explicit fuel columns (vlsfo/lsmgo sea+port), not me/aux _port.
  const pf = row as unknown as {
    vlsfo_sea_mt_day?: number | null;
    vlsfo_port_mt_day?: number | null;
    lsmgo_sea_mt_day?: number | null;
    lsmgo_port_mt_day?: number | null;
  };
  const vv = v as unknown as { gross_tonnage?: number | null; scnrt?: number | null; max_loa_m?: number | null };
  const market = "listing_key" in row ? row : null;
  const publicId = market?.listing_key ?? row.id;
  const isOwned = market?.is_owned ?? ownedAccess.isOwned ?? false;
  const canManage = market?.can_manage ?? ownedAccess.canManage ?? false;
  const rawVesselId =
    "listing_key" in row
      ? (v as { id?: string | null }).id ?? null
      : row.vessel_id ?? ("id" in v ? v.id : null);
  return {
    id: publicId,
    listingKey: market?.listing_key ?? ownedAccess.listingKey ?? null,
    ownedListingId:
      market?.owned_listing_id ?? ownedAccess.ownedListingId ?? null,
    isOwned,
    canManage,
    listingKeyExpiresAt:
      market?.expires_at ?? ownedAccess.listingKeyExpiresAt ?? null,
    vesselId: canManage && rawVesselId ? rawVesselId : undefined,
    identityMasked:
      Boolean((v as { is_tbn?: boolean }).is_tbn) && !canManage,
    gt: vv.gross_tonnage ?? null,
    scnrt: vv.scnrt ?? null,
    loaM: vv.max_loa_m ?? null,
    name: stripVesselNamePrefix(v.vessel_name),
    imo: v.imo_number ?? "—",
    type: v.vessel_type,
    flag: v.flag ?? "—",
    dwt: v.dwt_grain != null ? numFmt.format(v.dwt_grain) : "—",
    grainCap: v.grain_cbm != null ? numFmt.format(v.grain_cbm) : "—",
    built: v.build_year,
    age: vesselAge(v.build_year),
    geared: v.is_geared,
    grainCertified: v.grain_certified,
    dgCertified: v.dg_certified,
    openPort: row.open_port_name ?? "—",
    openPortLocode: row.open_port_locode,
    openPortZone: row.open_zone ?? "—",
    openDate: row.open_date ?? "—",
    openDateUrgency: urgencyFromDays(days),
    openDateDays: days,
    // Freshness clock — when the position was posted/last confirmed
    postedAt: (row as { refreshed_at?: string | null }).refreshed_at ?? row.created_at ?? null,
    status: statusFromAvailability(row.status),
    matches: market?.match_count ?? matches,
    poster: posterView(market?.poster),
    fuel: {
      vlsfoSea: pf.vlsfo_sea_mt_day ?? "—",
      vlsfoPort: pf.vlsfo_port_mt_day ?? "—",
      lsmgoSea: pf.lsmgo_sea_mt_day ?? "—",
      lsmgoPort: pf.lsmgo_port_mt_day ?? "—",
    },
    draft: meters(v.max_draft_m),
    preferredZones: v.preferred_zones,
    serviceSpeed: row.service_speed_kn,
    fuelType: row.fuel_type,
    openDateRangeDays: row.open_date_range_days,
    lastCargo: row.last_cargo,
    acceptsPartCargo: row.accepts_part_cargo,
    matchingFacts: {
      availabilityId: publicId,
      availabilityStatus: row.status,
      availabilityReviewStatus: row.review_status,
      // Governed market rows are emitted only after the SQL sanctions gate.
      // Owner rows carry the stored boolean; a malformed/missing value is
      // treated as blocked. Neither path guesses from the public risk label.
      isSanctioned: market
        ? false
        : (v as { is_sanctioned?: boolean }).is_sanctioned !== false,
      dwtGrainMt: v.dwt_grain,
      vesselType: v.vessel_type,
      openZone: row.open_zone,
      openDateDay: civilDayOrdinal(row.open_date),
      acceptsPartCargo: row.accepts_part_cargo,
      isGeared: v.is_geared,
      grainCertified: v.grain_certified,
      dgCertified: v.dg_certified,
      buildYear: v.build_year,
      maxDraftM: v.max_draft_m,
      maxLoaM: vv.max_loa_m ?? null,
      freightIdeaUsdMt: row.freight_idea_usd_mt,
    },
  };
}

function statusFromAvailability(
  status: VesselAvailabilityWithVessel["status"],
): VesselStatusView {
  if (status === "OPEN") return "open";
  if (status === "FIXED") return "fixed";
  return "review";
}

export function vesselFromMyVessel(row: MyVesselRow): VesselView {
  // Estimator/Suez toll prefer the real certificate figures when on file.
  const rr = row as unknown as { gross_tonnage?: number | null; scnrt?: number | null };
  return {
    id: row.id,
    vesselId: row.id,
    gt: rr.gross_tonnage ?? null,
    scnrt: rr.scnrt ?? null,
    loaM: row.max_loa_m ?? null,
    name: stripVesselNamePrefix(row.vessel_name),
    imo: row.imo_number ?? "—",
    type: row.vessel_type,
    flag: row.flag ?? "—",
    dwt: row.dwt_grain != null ? numFmt.format(row.dwt_grain) : "—",
    grainCap: row.grain_cbm != null ? numFmt.format(row.grain_cbm) : "—",
    built: row.build_year,
    age: vesselAge(row.build_year),
    geared: row.is_geared,
    grainCertified: row.grain_certified,
    dgCertified: row.dg_certified,
    openPort: row.open_port_name ?? "—",
    openPortLocode: row.open_port_locode,
    openPortZone: row.open_zone ?? "—",
    openDate: row.open_date ?? "—",
    openDateUrgency: urgencyFromDays(daysFromNow(row.open_date)),
    openDateDays: daysFromNow(row.open_date),
    status: row.open_availability_count > 0 ? "open" : "review",
    matches: 0,
    fuel: { vlsfoSea: "—", vlsfoPort: "—", lsmgoSea: "—", lsmgoPort: "—" },
    dwtBale: row.dwt_bale != null ? numFmt.format(row.dwt_bale) : undefined,
    loa: meters(row.max_loa_m),
    beam: meters(row.beam_m),
    draft: meters(row.max_draft_m),
    preferredZones: row.preferred_zones,
  };
}
