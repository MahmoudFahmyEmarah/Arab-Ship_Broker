// ============================================================
// ARAB SHIPBROKER — MATCH SCORING ENGINE
// ============================================================
// Maritime brokerage logic:
// - DWCC is the matchmaking number, not DWT
// - Volume check runs alongside weight when SF > 0.83 m³/t
// - Output: Strong / Good / Possible / Weak (never numeric scores)
// - Hard blocks: sanctioned, gear missing, grain cert missing, oversized 2.5x+
// ============================================================

import type { CargoListing, VesselAvailability } from '../types'

export type MatchLabel = 'Strong' | 'Good' | 'Possible' | 'Weak' | 'BLOCKED'

export interface MatchResult {
  cargo_id: string
  vessel_avail_id: string
  label: MatchLabel
  raw_score: number
  blockers: string[]
  warnings: string[]
  breakdown: {
    dwcc: number
    volume: number
    zone: number
    timing: number
    type: number
  }
}

// ─── ZONE ADJACENCY MAP ─────────────────────────────────────
// Adjacency = vessel can reasonably reposition between
const ZONE_ADJACENCY: Record<string, string[]> = {
  'B.SEA':    ['E.MED', 'ADRIATIC'],
  'E.MED':    ['B.SEA', 'C.MED', 'ADRIATIC', 'R.SEA'],
  'C.MED':    ['E.MED', 'W.MED', 'ADRIATIC'],
  'W.MED':    ['C.MED', 'NCONT'],
  'ADRIATIC': ['B.SEA', 'E.MED', 'C.MED'],
  'R.SEA':    ['E.MED', 'AG', 'A.SEA'],
  'AG':       ['R.SEA', 'A.SEA'],
  'A.SEA':    ['R.SEA', 'AG', 'ECI'],
}

// ─── HARD BLOCKS ────────────────────────────────────────────
function checkHardBlocks(cargo: CargoListing, va: VesselAvailability): string[] {
  const blockers: string[] = []
  const vessel = va.vessel

  if (!vessel) {
    blockers.push('Vessel record missing')
    return blockers
  }

  if (vessel.is_sanctioned) {
    blockers.push('Vessel is sanctioned')
  }

  // Gear requirement
  if (cargo.requires_geared === true && vessel.is_geared === false) {
    blockers.push('Cargo requires geared vessel, vessel is gearless')
  }

  // Grain certification — hard block per IMO Grain Code
  if (cargo.is_grain_cargo && vessel.grain_certified === false) {
    blockers.push('Grain cargo requires grain-certified vessel (Grain Code)')
  }

  // DG certification
  if (cargo.is_dg_cargo && vessel.dg_certified === false) {
    blockers.push('DG cargo requires DG-certified vessel')
  }

  // LOA / draft restriction
  if (cargo.max_loa_m && vessel.max_loa_m && vessel.max_loa_m > cargo.max_loa_m) {
    blockers.push(`Vessel LOA ${vessel.max_loa_m}m exceeds max ${cargo.max_loa_m}m`)
  }
  if (cargo.max_draft_m && vessel.max_draft_m && vessel.max_draft_m > cargo.max_draft_m) {
    blockers.push(`Vessel draft ${vessel.max_draft_m}m exceeds max ${cargo.max_draft_m}m`)
  }

  // Age restriction
  if (cargo.max_vessel_age_yr && vessel.build_year) {
    const age = new Date().getFullYear() - vessel.build_year
    if (age > cargo.max_vessel_age_yr) {
      blockers.push(`Vessel age ${age} years exceeds max ${cargo.max_vessel_age_yr}`)
    }
  }

  // Size sanity — vessel too small for cargo
  const dwcc = vessel.dwcc ?? vessel.dwt_grain
  if (dwcc && !va.accepts_part_cargo && dwcc < cargo.qty_min_mt * 0.85) {
    blockers.push(`Vessel ${dwcc.toLocaleString()} MT too small for cargo min ${cargo.qty_min_mt.toLocaleString()} MT`)
  }

  // Size sanity — vessel grossly oversized (>2.5x max)
  if (dwcc && dwcc > cargo.qty_max_mt * 2.5) {
    blockers.push(`Vessel ${dwcc.toLocaleString()} MT grossly oversized for cargo max ${cargo.qty_max_mt.toLocaleString()} MT`)
  }

  return blockers
}

// ─── DWCC FIT ───────────────────────────────────────────────
function scoreDwcc(cargo: CargoListing, va: VesselAvailability): number {
  const dwcc = va.vessel?.dwcc ?? va.vessel?.dwt_grain
  if (!dwcc) return 0.3 // unknown = low confidence

  // Perfect fit: vessel can take full max quantity with 0-20% spare
  if (dwcc >= cargo.qty_max_mt && dwcc <= cargo.qty_max_mt * 1.2) return 1.0
  // Acceptable: 20-50% spare
  if (dwcc >= cargo.qty_max_mt && dwcc <= cargo.qty_max_mt * 1.5) return 0.85
  // Loose: 50-100% spare
  if (dwcc >= cargo.qty_max_mt && dwcc <= cargo.qty_max_mt * 2.0) return 0.6
  // Smaller than max but in range
  if (dwcc >= cargo.qty_min_mt && dwcc < cargo.qty_max_mt) {
    return va.accepts_part_cargo ? 0.75 : 0.55
  }
  return 0.3
}

// ─── VOLUME FIT ─────────────────────────────────────────────
function scoreVolume(cargo: CargoListing, va: VesselAvailability): { score: number; warning?: string } {
  const sf = cargo.stowage_factor
  if (!sf) return { score: 0.5, warning: 'Stowage factor not declared' }

  // Cargo is weight-out if SF ≤ 0.83 m³/t (heavy cargo) — volume not binding
  if (sf <= 0.83) return { score: 1.0 }

  // Cubic-out cargo — volume binding
  const vesselVol = va.vessel?.grain_cbm ?? va.vessel?.bale_cbm
  if (!vesselVol) {
    return { score: 0.4, warning: 'Vessel grain capacity unknown — volume check required' }
  }

  const requiredVol = cargo.qty_max_mt * sf
  const ratio = vesselVol / requiredVol

  if (ratio >= 1.10) return { score: 1.0 }
  if (ratio >= 1.00) return { score: 0.85, warning: 'Tight volume fit' }
  if (ratio >= 0.95) return { score: 0.6, warning: 'Insufficient cube — may need cargo reduction' }
  return { score: 0.25, warning: 'Volume insufficient for cargo' }
}

// ─── ZONE FIT ───────────────────────────────────────────────
function scoreZone(cargo: CargoListing, va: VesselAvailability): number {
  const vZone = va.open_zone
  const cZone = cargo.load_zone

  if (!vZone || !cZone) return 0.3
  if (vZone === cZone) return 1.0

  const adjacent = ZONE_ADJACENCY[vZone] ?? []
  if (adjacent.includes(cZone)) return 0.7

  // Two hops via adjacency
  for (const intermediate of adjacent) {
    if ((ZONE_ADJACENCY[intermediate] ?? []).includes(cZone)) return 0.45
  }

  return 0.2
}

// ─── TIMING FIT ─────────────────────────────────────────────
function scoreTiming(cargo: CargoListing, va: VesselAvailability): { score: number; warning?: string } {
  // Cargo is SPOT → vessel just needs to be open soonish
  if (cargo.is_spot) {
    if (!va.open_date) return { score: 1.0 } // SPOT vessel + SPOT cargo
    const daysToOpen = (new Date(va.open_date).getTime() - Date.now()) / 86400000
    if (daysToOpen <= 7) return { score: 1.0 }
    if (daysToOpen <= 14) return { score: 0.85 }
    if (daysToOpen <= 30) return { score: 0.65 }
    return { score: 0.3 }
  }

  // Cargo has laycan window
  if (!cargo.laycan_from || !cargo.laycan_to) return { score: 0.5 }

  const laycanFrom = new Date(cargo.laycan_from)
  const laycanTo   = new Date(cargo.laycan_to)

  // Vessel SPOT or no open date → can adapt
  if (!va.open_date) {
    const daysUntilLaycan = (laycanFrom.getTime() - Date.now()) / 86400000
    if (daysUntilLaycan <= 7) return { score: 0.95 }
    if (daysUntilLaycan <= 21) return { score: 0.8 }
    return { score: 0.55 }
  }

  const vesselOpen = new Date(va.open_date)
  const flexDays = va.open_date_range_days ?? 0
  const vesselWindowStart = new Date(vesselOpen.getTime() - flexDays * 86400000)
  const vesselWindowEnd   = new Date(vesselOpen.getTime() + flexDays * 86400000)

  // Direct overlap
  if (vesselWindowEnd >= laycanFrom && vesselWindowStart <= laycanTo) {
    return { score: 1.0 }
  }

  // Vessel slightly early
  const daysEarly = (laycanFrom.getTime() - vesselWindowEnd.getTime()) / 86400000
  if (daysEarly > 0 && daysEarly <= 7) return { score: 0.85, warning: `Vessel opens ${Math.round(daysEarly)}d before laycan` }
  if (daysEarly > 0 && daysEarly <= 14) return { score: 0.6, warning: `Vessel opens ${Math.round(daysEarly)}d before laycan` }

  // Vessel slightly late
  const daysLate = (vesselWindowStart.getTime() - laycanTo.getTime()) / 86400000
  if (daysLate > 0 && daysLate <= 5) return { score: 0.7, warning: `Vessel opens ${Math.round(daysLate)}d after laycan` }

  return { score: 0.2 }
}

// ─── VESSEL TYPE COMPATIBILITY ──────────────────────────────
function scoreType(cargo: CargoListing, va: VesselAvailability): number {
  const vType = va.vessel?.vessel_type
  if (!vType) return 0.6

  if (cargo.cargo_type === 'Break Bulk') {
    if (vType === 'General Cargo') return 1.0
    if (vType === 'Bulk Carrier') return 0.65 // possible but suboptimal
    return 0.5
  }

  if (cargo.cargo_type === 'Dry Bulk') {
    if (vType === 'Bulk Carrier') return 1.0
    if (vType === 'General Cargo') return 0.9 // GC can take bulk
    return 0.5
  }

  return 0.7
}

// ─── CONVERT SCORE TO LABEL ─────────────────────────────────
function scoreToLabel(score: number): MatchLabel {
  if (score >= 0.85) return 'Strong'
  if (score >= 0.70) return 'Good'
  if (score >= 0.50) return 'Possible'
  if (score >= 0.30) return 'Weak'
  return 'BLOCKED' // sentinel — won't be stored
}

// ─── MAIN ENTRY POINT ───────────────────────────────────────
export function scoreMatch(cargo: CargoListing, va: VesselAvailability): MatchResult {
  const blockers = checkHardBlocks(cargo, va)
  const warnings: string[] = []

  // Hard block → return blocked, don't bother scoring
  if (blockers.length > 0) {
    return {
      cargo_id: cargo.id,
      vessel_avail_id: va.id,
      label: 'BLOCKED',
      raw_score: 0,
      blockers,
      warnings: [],
      breakdown: { dwcc: 0, volume: 0, zone: 0, timing: 0, type: 0 }
    }
  }

  // Score each dimension
  const dwccScore = scoreDwcc(cargo, va)
  const vol  = scoreVolume(cargo, va);    if (vol.warning) warnings.push(vol.warning)
  const time = scoreTiming(cargo, va);    if (time.warning) warnings.push(time.warning)
  const zoneScore = scoreZone(cargo, va)
  const typeScore = scoreType(cargo, va)

  // WOG warning
  if (cargo.is_wog) warnings.push('Cargo offered WOG — verify before action')

  // High SF without grain cert → soft warning
  if (cargo.stowage_factor && cargo.stowage_factor > 0.83 && !va.vessel?.grain_certified) {
    warnings.push('Cubic-out cargo — confirm grain capability')
  }

  // Weighted average
  const score = (
    dwccScore * 0.30 +
    vol.score * 0.20 +
    zoneScore * 0.25 +
    time.score * 0.15 +
    typeScore * 0.10
  )

  return {
    cargo_id: cargo.id,
    vessel_avail_id: va.id,
    label: scoreToLabel(score),
    raw_score: Math.round(score * 100) / 100,
    blockers: [],
    warnings,
    breakdown: {
      dwcc: dwccScore,
      volume: vol.score,
      zone: zoneScore,
      timing: time.score,
      type: typeScore,
    }
  }
}

// ─── BULK MATCH ─────────────────────────────────────────────
export function findMatches(cargo: CargoListing, vessels: VesselAvailability[]): MatchResult[] {
  return vessels
    .map(v => scoreMatch(cargo, v))
    .filter(m => m.label !== 'BLOCKED')
    .sort((a, b) => b.raw_score - a.raw_score)
}

export function findCargoForVessel(va: VesselAvailability, cargoList: CargoListing[]): MatchResult[] {
  return cargoList
    .map(c => scoreMatch(c, va))
    .filter(m => m.label !== 'BLOCKED')
    .sort((a, b) => b.raw_score - a.raw_score)
}
