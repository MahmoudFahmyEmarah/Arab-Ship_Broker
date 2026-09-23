// Duplicate-pair detection for Review — the design's "Duplicate pairs" cards.
// Pure functions over already-fetched rows, so they are unit-testable and the
// server action only does the reads.
//
// Two rules, mirroring the gate's uniqueness family:
//   DQ-U03  the same cargo staged twice under different refs — typically the
//           workbook's CM- ref and a circular's provisional EM-/WA- ref.
//   DQ-U04  the same ship staged with an IMO and, in the queue, without one.

export interface StagedLite {
  id: string;
  sheet: string;
  business_key: string | null;
  classification: string;
  committed: boolean;
  payload: Record<string, unknown>;
  batch_id: string;
}

export interface QueuedVesselLite {
  id: string;
  vessel_name: string;
  built: number | null;
  dwt_grain: number | null;
}

export interface DupSide {
  /** staged row id, or queue id for the IMO-less vessel side */
  id: string;
  origin: "staged" | "queue";
  label: string;
  fields: [string, string][];
  keep: boolean;
}

export interface DupPair {
  id: string;
  rule: "DQ-U03" | "DQ-U04";
  title: string;
  why: string;
  sides: [DupSide, DupSide];
}

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));

/** The identity of a cargo, ignoring its ref — the same basis the provisional
 *  ref is minted from, so a CM- row and its EM- twin hash alike. */
export function cargoIdentity(p: Record<string, unknown>): string {
  return [p.commodity_name, p.qty_min_mt, p.qty_max_mt, p.load_port_name, p.load_zone, p.disch_port_name, p.disch_zone, p.laycan_from, p.laycan_to]
    .map(norm).join("|");
}

const isProvisional = (key: string | null) => !!key && /^(EM|WA)-/i.test(key);

function cargoFields(p: Record<string, unknown>): [string, string][] {
  return [
    ["REF", show(p.ref)],
    ["Commodity", show(p.commodity_name)],
    ["Qty", p.qty_min_mt != null ? `${show(p.qty_min_mt)}–${show(p.qty_max_mt)} MT` : "—"],
    ["Route", `${show(p.load_port_name)} → ${show(p.disch_port_name)}`],
    ["Laycan", `${show(p.laycan_from)} – ${show(p.laycan_to)}`],
    ["Freight", show(p.freight_idea_usd_mt)],
  ];
}

function vesselFields(p: Record<string, unknown>): [string, string][] {
  return [
    ["IMO", show(p.imo_number)],
    ["Name", show(p.vessel_name)],
    ["DWT", show(p.dwt_grain)],
    ["Built", show(p.build_year)],
    ["Flag", show(p.flag)],
  ];
}

/** DQ-U03: cargo rows with the same identity but different refs. The row
 *  carrying a real broker ref is kept; if both are provisional, the older
 *  (lower row) is kept. Committed rows are never a candidate for dropping. */
export function findCargoDuplicates(rows: StagedLite[]): DupPair[] {
  const groups = new Map<string, StagedLite[]>();
  for (const r of rows) {
    if (r.sheet !== "cargo") continue;
    const key = cargoIdentity(r.payload);
    if (!key.replace(/\|/g, "")) continue; // nothing identifying
    const g = groups.get(key);
    if (g) g.push(r); else groups.set(key, [r]);
  }
  const out: DupPair[] = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const refs = new Set(g.map((r) => r.business_key));
    if (refs.size < 2) continue; // same ref twice is an ordinary re-sync, not a pair
    const sorted = [...g].sort((a, b) => {
      const pa = isProvisional(a.business_key) ? 1 : 0, pb = isProvisional(b.business_key) ? 1 : 0;
      if (pa !== pb) return pa - pb;                 // real ref first
      if (a.committed !== b.committed) return a.committed ? -1 : 1;
      return a.id < b.id ? -1 : 1;
    });
    const keep = sorted[0];
    for (const drop of sorted.slice(1)) {
      if (drop.committed) continue;
      out.push({
        id: `u03:${keep.id}:${drop.id}`,
        rule: "DQ-U03",
        title: `${show(keep.payload.commodity_name)} · ${show(keep.payload.qty_min_mt)} MT · ${show(keep.payload.load_port_name)} → ${show(keep.payload.disch_port_name)}`,
        why: isProvisional(drop.business_key)
          ? "The same order arrived by workbook and by circular — the circular's provisional ref duplicates the broker's."
          : "Two rows describe the same order under different refs.",
        sides: [
          { id: keep.id, origin: "staged", label: `${isProvisional(keep.business_key) ? "Circular" : "Workbook"} · ${show(keep.business_key)}`, fields: cargoFields(keep.payload), keep: true },
          { id: drop.id, origin: "staged", label: `${isProvisional(drop.business_key) ? "Circular" : "Workbook"} · ${show(drop.business_key)}`, fields: cargoFields(drop.payload), keep: false },
        ],
      });
    }
  }
  return out;
}

/** DQ-U04: a staged vessel with an IMO whose name (and, when both known, build
 *  year / DWT within 5 %) matches a pending IMO-less queue entry. */
export function findVesselDuplicates(rows: StagedLite[], queue: QueuedVesselLite[]): DupPair[] {
  const out: DupPair[] = [];
  const byName = new Map<string, QueuedVesselLite[]>();
  for (const q of queue) {
    const k = norm(q.vessel_name);
    if (!k || k.startsWith("unnamed vessel")) continue;
    const g = byName.get(k); if (g) g.push(q); else byName.set(k, [q]);
  }
  for (const r of rows) {
    if (r.sheet !== "vessels" || !r.business_key) continue;
    const name = norm(r.payload.vessel_name);
    const cands = byName.get(name);
    if (!cands) continue;
    const built = r.payload.build_year == null ? null : Number(r.payload.build_year);
    const dwt = r.payload.dwt_grain == null ? null : Number(r.payload.dwt_grain);
    for (const q of cands) {
      if (q.built != null && built != null && q.built !== built) continue;
      if (q.dwt_grain != null && dwt != null && Math.abs(q.dwt_grain - dwt) > Math.max(100, dwt / 20)) continue;
      out.push({
        id: `u04:${r.id}:${q.id}`,
        rule: "DQ-U04",
        title: `${show(r.payload.vessel_name)} · ${r.business_key}`,
        why: "One row carries the IMO, the other is the circular's temporary record without it.",
        sides: [
          { id: r.id, origin: "staged", label: `Register · IMO ${r.business_key}`, fields: vesselFields(r.payload), keep: true },
          { id: q.id, origin: "queue", label: "Circular · no IMO", fields: [["IMO", "—"], ["Name", q.vessel_name], ["DWT", show(q.dwt_grain)], ["Built", show(q.built)]], keep: false },
        ],
      });
    }
  }
  return out;
}

/** Fields the dropped row can contribute to the kept one: only where the kept
 *  row is empty and the dropped row is not. */
export function mergePatch(keep: Record<string, unknown>, drop: Record<string, unknown>, allowed: Iterable<string>): Record<string, unknown> {
  const ok = new Set(allowed);
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(drop)) {
    if (!ok.has(k)) continue;
    if (v === null || v === undefined || v === "") continue;
    const cur = keep[k];
    if (cur === null || cur === undefined || cur === "") patch[k] = v;
  }
  return patch;
}
