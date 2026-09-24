// Fixture Room · recap rendering (23 Sep 2026).
//
// The database renders the authoritative text (fn_fixture_recap_text) and
// stores it with the version. This module renders the same structured content
// for the printable page and lets scripts/fixture-room-check.ts prove the
// TypeScript rendering is deterministic.
import type { FixtureRecapContent } from "./types";

export interface RecapSection { title: string; lines: string[] }

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function stamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}

export function recapSections(c: FixtureRecapContent): RecapSection[] {
  const header: RecapSection = {
    title: `Fixture recap · ${c.cargo.commodity ?? "—"} / ${c.vessel.name ?? "—"}`,
    lines: [
      `Ref ${c.ref} · room v${c.roomVersion} · ${stamp(c.generatedAt)}`,
      `Status: ${String(c.status).replace("_", " ").toUpperCase()}`,
      `Cargo: ${c.cargo.commodity ?? "—"} · ${c.cargo.qtyMin ?? "—"}–${c.cargo.qtyMax ?? "—"} MT · ${c.cargo.loadPort ?? "—"} → ${c.cargo.dischPort ?? "—"}`,
      `Vessel: ${c.vessel.name ?? "—"} (${c.vessel.type ?? "—"} · ${c.vessel.dwt ?? "—"} DWT)`,
    ],
  };
  const parties: RecapSection = {
    title: "Parties",
    lines: c.parties.map((p) => `${p.label}${p.name ? ` · ${p.name}` : ""}`),
  };
  const terms: RecapSection = {
    title: "Main terms",
    lines: [...c.terms]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((t) => {
        const v = t.status === "agreed"
          ? `${t.agreedValue ?? "—"}  [AGREED]`
          : t.status === "withdrawn"
            ? "[WITHDRAWN]"
            : `cargo ${t.cargoPosition ?? "—"} · vessel ${t.vesselPosition ?? "—"}  [OPEN]`;
        return `${t.sortOrder}. ${t.label}: ${v}`;
      }),
  };
  const subjects: RecapSection = {
    title: "Subjects",
    lines: c.subjects.length
      ? c.subjects.map((s) => `${s.title} [${String(s.status).toUpperCase()}]${s.deadlineAt ? ` · by ${stamp(s.deadlineAt)}` : ""}`)
      : ["none recorded"],
  };
  const footer: RecapSection = {
    title: "Notes",
    lines: [
      `Counterparty identity: ${c.counterpartyDisclosed ? "disclosed" : "withheld · via Arab ShipBroker"}`,
      ...(c.brokerageTerms && typeof c.brokerageTerms === "object" && "text" in c.brokerageTerms ? [`Brokerage: ${String((c.brokerageTerms as { text?: unknown }).text ?? "")}`] : []),
      "Sub all terms / details of C/P otherwise as per owners' proforma.",
    ],
  };
  return [header, parties, terms, subjects, footer];
}

/** Plain-text export of the same sections (deterministic for a given content). */
export function renderRecapText(c: FixtureRecapContent): string {
  return recapSections(c)
    .map((s, i) => (i === 0 ? [s.title.toUpperCase(), ...s.lines] : [s.title.toUpperCase(), ...s.lines.map((l) => `- ${l}`)]).join("\n"))
    .join("\n\n");
}
