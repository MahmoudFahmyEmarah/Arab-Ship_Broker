// The triple-gate classifier as a LangGraph state machine.
//
//   START → gate1 (relevance) ──irrelevant──▶ END
//                    │ cargo/vessel/mixed
//                    ▼
//                 gate2 (extract cargo and/or vessels)
//                    ▼
//                 gate3 (normalize: assign ASB regime, flag UNMAPPED)
//                    ▼
//                   END
//
// The LLM lives behind the Classifier interface (gate1/gate2); gate3 is pure and
// deterministic. Compiled once per run and invoked per email.

import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import type { Classifier, CargoRecord, VesselRecord, EmailMsg, ClassifyResult } from "./types";

// Commodities we recognise as GRAIN regime; anything else a human maps via the
// Manual Review queue (asb_regime = UNMAPPED).
const GRAIN_TERMS = [
  "wheat", "corn", "maize", "barley", "sorghum", "soya", "soybean", "soy bean",
  "soybean meal", "soya meal", "rapeseed", "canola", "sunflower", "rice", "oats",
  "rye", "millet", "grain", "meal", "seed", "beans", "peas", "lentil", "chickpea",
];

const VALID_REGIMES = new Set(["GRAIN", "IMSBC", "CSS", "MULTI-PARCEL"]);

function grainHeuristic(commodity: string | null | undefined): "GRAIN" | "UNMAPPED" {
  const name = (commodity ?? "").toLowerCase();
  return name.length > 0 && GRAIN_TERMS.some((t) => name.includes(t)) ? "GRAIN" : "UNMAPPED";
}

export function assignRegime(rec: CargoRecord): CargoRecord {
  return { ...rec, asb_regime: grainHeuristic(rec.commodity) };
}

// Hard guardrail for year-less laycans: circulars quote "10–20 Jun" with no year,
// and the model may default it to a past year. A laycan is always near-term, so
// any ISO date whose year is BEFORE the current year is re-stamped to the current
// year. Genuine future dates and SPOT/PPT (non-ISO) are left untouched.
function fixLaycanYear(v: string | null | undefined, currentYear: number): string | null | undefined {
  if (typeof v !== "string") return v;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return v;
  return Number(m[1]) < currentYear ? `${currentYear}-${m[2]}-${m[3]}` : v;
}

// ── SANITATION — raw LLM output must never reach a contact or the DB as-is ──
// The model occasionally garbles a field (e.g. stuffing a slice of the source
// message into vessel_type). Every string is clipped/whitespace-collapsed and
// dropped when it exceeds a sane length for its meaning; the critical numbers
// (IMO, DWT) get deterministic REGEX fallbacks from the source text.

/** collapse whitespace; drop empty or absurdly long values (garbled output). */
export function clip(v: string | null | undefined, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s && s.length <= max ? s : null;
}

/** deterministic IMO from text: the 6–8 digits after the word "IMO". */
export function imoFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = /\bIMO[\s:#.-]*([0-9]{6,8})\b/i.exec(text);
  return m?.[1] ?? null;
}

/** deterministic DWT from text: "17k dwt", "17,000 dwt", "dwt 17000". */
export function dwtFromText(text: string | null | undefined): number | null {
  if (!text) return null;
  const m =
    /(\d{1,3}(?:[.,]\d{3})+|\d+(?:\.\d+)?)(\s*k)?\s*(?:dwcc|dwat|dwt)\b/i.exec(text) ??
    /\b(?:dwcc|dwat|dwt)\s*:?\s*(\d{1,3}(?:[.,]\d{3})+|\d+(?:\.\d+)?)(\s*k)?/i.exec(text);
  if (!m) return null;
  let n = Number.parseFloat(m[1].replace(/[.,](?=\d{3}\b)/g, "").replace(",", "."));
  if (m[2]) n *= 1000;
  return Number.isFinite(n) && n >= 500 && n <= 500_000 ? Math.round(n) : null;
}

/** Sanitize + repair one vessel record against its source text. */
export function normalizeVessel(rec: VesselRecord, srcText?: string | null): VesselRecord {
  const r: VesselRecord = { ...rec };
  r.vessel_name = clip(r.vessel_name, 50);
  r.flag = clip(r.flag, 30);
  r.open_port = clip(r.open_port, 40);
  r.open_country = clip(r.open_country, 30);
  r.direction = clip(r.direction, 80);
  // vessel type: normalize to the two-value model; garbage → derive or drop
  const vt = (clip(r.vessel_type, 60) ?? "").toLowerCase();
  r.vessel_type = vt.includes("bulk") ? "Bulk Carrier"
    : vt.includes("cargo") || vt.includes("general") || vt.includes("mpp") || vt.includes("multi") ? "Cargo Ship"
    : null;
  if (!r.vessel_type && /bulk/i.test(srcText ?? "")) r.vessel_type = "Bulk Carrier";
  // IMO: digits only, 6–8; else recover from the text deterministically
  const imoDigits = (r.imo ?? "").replace(/\D/g, "");
  r.imo = imoDigits.length >= 6 && imoDigits.length <= 8 ? imoDigits : imoFromText(srcText);
  // DWT: sane range or recover from the text
  if (r.dwt == null || !Number.isFinite(r.dwt) || r.dwt < 500 || r.dwt > 500_000) {
    r.dwt = dwtFromText(srcText);
  }
  if (r.built != null && (r.built < 1900 || r.built > new Date().getFullYear() + 2)) r.built = null;
  return r;
}

// Deterministic cleanup so a half-extracted quantity never invalidates a row
// (both qty bounds are NOT NULL — mirror a lone one), the laycan year is sane,
// the ASB regime is assigned, and every string is sanitized.
export function normalizeCargo(rec: CargoRecord, currentYear = new Date().getFullYear()): CargoRecord {
  // Trust the LLM's regime when it gave a valid one; otherwise fall back to the
  // grain keyword heuristic (→ GRAIN or UNMAPPED for Manual Review).
  const regime = rec.asb_regime && VALID_REGIMES.has(rec.asb_regime)
    ? rec.asb_regime
    : grainHeuristic(rec.commodity);
  const r: CargoRecord = { ...rec, asb_regime: regime };
  r.commodity = clip(r.commodity, 60);
  r.packaging = clip(r.packaging, 30);
  r.load_port = clip(r.load_port, 40);
  r.disch_port = clip(r.disch_port, 60);
  r.broker = clip(r.broker, 50);
  r.load_rate = clip(r.load_rate, 40);
  r.disch_rate = clip(r.disch_rate, 40);
  r.laytime_structure = clip(r.laytime_structure, 60);
  r.notes = clip(r.notes, 200);
  if (r.qty_min_mt == null && r.qty_max_mt != null) r.qty_min_mt = r.qty_max_mt;
  if (r.qty_max_mt == null && r.qty_min_mt != null) r.qty_max_mt = r.qty_min_mt;
  r.laycan_from = fixLaycanYear(r.laycan_from, currentYear);
  r.laycan_to = fixLaycanYear(r.laycan_to, currentYear);
  return r;
}

const GraphState = Annotation.Root({
  emails: Annotation<EmailMsg[]>(),
  results: Annotation<ClassifyResult[]>({ reducer: (_a, b) => b, default: () => [] }),
  cargo: Annotation<CargoRecord[]>({ reducer: (_a, b) => b, default: () => [] }),
  vessels: Annotation<VesselRecord[]>({ reducer: (_a, b) => b, default: () => [] }),
  log: Annotation<string[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
});

export type ClassifierGraph = ReturnType<typeof buildClassifierGraph>;

export function buildClassifierGraph(clf: Classifier) {
  // gate1: ONE LLM call classifies + extracts a whole batch of emails.
  const gate1 = async (s: typeof GraphState.State) => {
    const results = await clf.classifyBatch(s.emails);
    const nc = results.reduce((a, r) => a + r.cargo.length, 0);
    const nv = results.reduce((a, r) => a + r.vessels.length, 0);
    return { results, log: [`gate1 · classified ${s.emails.length} email(s): ${nc} cargo, ${nv} vessel`] };
  };

  // gate2: deterministic normalization (regime, qty mirror, laycan year) + tag
  // each record with its source email (results are still aligned to s.emails).
  const gate2 = async (s: typeof GraphState.State) => {
    const currentYear = new Date().getFullYear();
    const srcOf = (e: EmailMsg) => ({ from: e.from, subject: e.subject, date: e.date, text: e.text.slice(0, 4000), msgId: e.id });
    const cargo = s.results.flatMap((r, i) => {
      const src = srcOf(s.emails[i]);
      return r.cargo.map((c) => ({ ...normalizeCargo(c, currentYear), __src: src }));
    });
    const vessels = s.results.flatMap((r, i) => {
      const src = srcOf(s.emails[i]);
      // sanitize against the SOURCE TEXT: garbled fields are clipped, and the
      // critical numbers (IMO, DWT) are recovered deterministically by regex.
      return r.vessels.map((v) => ({ ...normalizeVessel(v, s.emails[i].text), __src: src }));
    });
    const unmapped = cargo.filter((c) => c.asb_regime === "UNMAPPED").length;
    return { cargo, vessels, log: [`gate2 · normalized ${cargo.length} cargo; ${unmapped} UNMAPPED → Manual Review`] };
  };

  const graph = new StateGraph(GraphState)
    .addNode("gate1", gate1)
    .addNode("gate2", gate2)
    .addEdge(START, "gate1")
    .addEdge("gate1", "gate2")
    .addEdge("gate2", END);

  return graph.compile();
}
