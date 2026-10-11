// Fixture Room · the ONE canonical recap model (C2O-101 P1-3, 9 Oct 2026).
//
// The published recap content (fixture_recap_versions.content) is rendered three ways: the plain text the database
// stores (public.fn_fixture_recap_text → content_text, hashed into content_hash), the printable page, and the stored
// PDF. All three now come from this model, so a term's state, a withdrawn term, the brokerage line and the subjects
// read the same everywhere. recapText() mirrors fn_fixture_recap_text line for line; scripts/fixture-recap-parity.ts
// compares the two on the same contents.
import type { FixtureRecapContent } from "./types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** to_char(ts, 'DD Mon YYYY HH24:MI "UTC"') in a UTC session */
export function utcStamp(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

/** jsonb's text form (PostgreSQL orders object keys by length, then bytes; ", " and ": " separators). */
export function jsonbText(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return `[${v.map(jsonbText).join(", ")}]`;
  const keys = Object.keys(v as Record<string, unknown>).sort((a, b) => (a.length - b.length) || (a < b ? -1 : a > b ? 1 : 0));
  return `{${keys.map((k) => `${JSON.stringify(k)}: ${jsonbText((v as Record<string, unknown>)[k])}`).join(", ")}}`;
}

/** jsonb ->> text of a scalar (numbers as stored, null as SQL NULL) */
const t = (v: unknown): string | null => (v === null || v === undefined ? null : typeof v === "object" ? jsonbText(v) : String(v));
/** format('%s', x): NULL prints as an empty string */
const f = (v: unknown): string => t(v) ?? "";

export type RecapTermState = "agreed" | "withdrawn" | "open";
export interface RecapModel {
  ref: string;
  status: string;                     // e.g. "ON SUBJECTS"
  roomVersion: string;
  generatedAt: string;                // UTC stamp
  commodity: string; vesselName: string; vesselType: string; vesselDwt: string;
  qtyMin: string; qtyMax: string; loadPort: string; dischPort: string;
  parties: { label: string; name: string | null }[];
  terms: { sortOrder: string; label: string; state: RecapTermState; value: string; statusLabel: string }[];
  subjects: { title: string; status: string; responsibleSide: string | null; deadline: string }[];
  counterpartyDisclosed: boolean;
  brokerage: string | null;
  standardClause: string;
}

export function recapModel(c: FixtureRecapContent): RecapModel {
  // coalesce(c->'brokerageTerms'->>'text', c->'brokerageTerms'::text) when present and not JSON null
  const bt = c.brokerageTerms as unknown;
  const btText = bt !== null && typeof bt === "object" && !Array.isArray(bt) ? t((bt as Record<string, unknown>).text) : null;
  const brokerage = bt === null || bt === undefined ? null : btText ?? jsonbText(bt);
  return {
    ref: f(c.ref),
    status: f(c.status).replace(/_/g, " ").toUpperCase(),
    roomVersion: f(c.roomVersion),
    generatedAt: utcStamp(c.generatedAt),
    commodity: f(c.cargo?.commodity), vesselName: f(c.vessel?.name), vesselType: f(c.vessel?.type), vesselDwt: f(c.vessel?.dwt),
    qtyMin: f(c.cargo?.qtyMin), qtyMax: f(c.cargo?.qtyMax), loadPort: f(c.cargo?.loadPort), dischPort: f(c.cargo?.dischPort),
    parties: (c.parties ?? []).map((p) => ({ label: f(p.label), name: t(p.name) })),
    terms: (c.terms ?? []).map((x) => {
      const state: RecapTermState = x.status === "agreed" ? "agreed" : x.status === "withdrawn" ? "withdrawn" : "open";
      return {
        sortOrder: f(x.sortOrder), label: f(x.label), state,
        value: state === "agreed" ? f(x.agreedValue) : state === "withdrawn" ? "" : `cargo ${t(x.cargoPosition) ?? "—"} · vessel ${t(x.vesselPosition) ?? "—"}`,
        statusLabel: state === "agreed" ? "AGREED" : state === "withdrawn" ? "WITHDRAWN" : "OPEN",
      };
    }),
    subjects: (c.subjects ?? []).map((s) => ({ title: f(s.title), status: f(s.status).toUpperCase(), responsibleSide: t(s.responsibleSide), deadline: utcStamp(s.deadlineAt) })),
    counterpartyDisclosed: c.counterpartyDisclosed === true,
    brokerage,
    standardClause: "Sub all terms / details of C/P otherwise as per owners' proforma.",
  };
}

/** The canonical recap text — line for line what public.fn_fixture_recap_text stores (and hashes). */
export function recapText(c: FixtureRecapContent): string {
  const m = recapModel(c);
  const l: string[] = [];
  l.push(`FIXTURE RECAP · ${m.commodity} / ${m.vesselName}`);
  l.push(`Ref ${m.ref} · room v${m.roomVersion} · ${m.generatedAt}`);
  l.push(`Status: ${m.status}`);
  l.push("");
  l.push(`Cargo:  ${m.commodity} · ${m.qtyMin}–${m.qtyMax} MT · ${m.loadPort} → ${m.dischPort}`);
  l.push(`Vessel: ${m.vesselName} (${m.vesselType} · ${m.vesselDwt} DWT)`);
  l.push("");
  l.push("PARTIES");
  for (const p of m.parties) l.push(`- ${p.label}${p.name !== null ? ` · ${p.name}` : ""}`);
  l.push("");
  l.push("MAIN TERMS");
  for (const x of m.terms) l.push(`${x.sortOrder}. ${x.label}: ${x.state === "agreed" ? `${x.value}  [AGREED]` : x.state === "withdrawn" ? "[WITHDRAWN]" : `${x.value}  [OPEN]`}`);
  l.push("");
  l.push("SUBJECTS");
  if (!m.subjects.length) l.push("- none recorded");
  for (const s of m.subjects) l.push(`- ${s.title} [${s.status}]${s.deadline ? ` · by ${s.deadline}` : ""}`);
  l.push("");
  l.push(`Counterparty identity: ${m.counterpartyDisclosed ? "disclosed" : "withheld · via Arab ShipBroker"}`);
  if (m.brokerage !== null) l.push(`Brokerage: ${m.brokerage}`);
  l.push(m.standardClause);
  return l.join("\n");
}
