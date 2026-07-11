// Portal/map access to the canonical zone registry. The source of truth is
// lib/zones — this module just re-exports it so existing imports from
// "@/lib/portal/zones" keep resolving. `ZoneDef` is kept as an alias of the
// registry's `ZoneMeta` for back-compat.
export {
  ZONES,
  ZONE_CODES,
  ZONE_LABELS,
  FLEET_ZONES,
  zoneByCode,
  zoneCentroid,
  zonesLabel,
} from "@/lib/zones";
export type { ZoneCode, ZoneMeta, ZoneMeta as ZoneDef } from "@/lib/zones";
