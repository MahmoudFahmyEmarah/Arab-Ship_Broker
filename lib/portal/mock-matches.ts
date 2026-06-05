// Sample match lists for the /portal preview (when Supabase isn't configured).
// Derived from the same mock listings so the detail panel shows a realistic set.
import { MOCK_CARGOS, MOCK_VESSELS } from "./mock";
import { MatchVesselView, MatchCargoView } from "./match-views";

function seed(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(id.length - 1 - i)) | 0;
  return Math.abs(h);
}

export function sampleCargoMatches(cargoId: string): MatchVesselView[] {
  const n = 2 + (seed(cargoId) % 3); // 2–4
  const start = seed(cargoId) % MOCK_VESSELS.length;
  const out: MatchVesselView[] = [];
  for (let i = 0; i < n; i++) {
    const r = MOCK_VESSELS[(start + i) % MOCK_VESSELS.length];
    const v = r.vessel;
    out.push({
      id: r.id,
      name: v.vessel_name,
      type: v.vessel_type,
      dwt: v.dwt_grain,
      flag: v.flag,
      built: v.build_year,
      openPort: r.open_port_name ?? "—",
      openZone: r.open_zone ?? "—",
      openDate: r.open_date,
      freight: r.freight_idea_usd_mt ?? 40 + (i * 7),
      rateAligned: i % 2 === 0,
      geared: v.is_geared,
    });
  }
  return out;
}

export function sampleAvailabilityMatches(availabilityId: string): MatchCargoView[] {
  const n = 2 + (seed(availabilityId) % 3);
  const start = seed(availabilityId) % MOCK_CARGOS.length;
  const out: MatchCargoView[] = [];
  for (let i = 0; i < n; i++) {
    const c = MOCK_CARGOS[(start + i) % MOCK_CARGOS.length];
    out.push({
      id: c.id,
      commodity: c.commodity_name,
      type: c.cargo_type,
      qtyMin: c.qty_min_mt,
      qtyMax: c.qty_max_mt,
      loadPort: c.load_port_name,
      loadZone: c.load_zone,
      dischPort: c.disch_port_name,
      dischZone: c.disch_zone,
      laycanFrom: c.laycan_from,
      laycanTo: c.laycan_to,
      isSpot: c.is_spot,
      freight: c.freight_idea_usd_mt,
      rateAligned: i % 2 === 0,
    });
  }
  return out;
}
