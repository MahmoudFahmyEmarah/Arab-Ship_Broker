// Fixture Room · the two documents a principal forwards: the Fixture Recap
// (one published, versioned recap) and the Negotiation Summary (the whole
// negotiation so far). One structured model, two renderers: the printable
// page today (browser "Save as PDF"), the server PDF once the shared PDF
// renderer lands (O2C-009). Built only from the masked read model the
// requester already holds, so a document can never show more than the room.
import type { FixtureRecapView, FixtureRoomView } from "./types";

export interface DocTable { columns: string[]; rows: string[][]; widths?: number[] }
export interface DocSection { title: string; table?: DocTable; lines?: string[] }
export interface FixtureDocument {
  kind: "recap" | "summary";
  title: string;
  subtitle: string;
  meta: [string, string][];
  sections: DocSection[];
  footer: string[];
  fileName: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function docStamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}
const statusText = (s: string) => s.replace(/_/g, " ").toUpperCase();
const dash = (v: unknown) => (v == null || v === "" ? "—" : String(v));

/** The Fixture Recap: a published recap version exactly as the server stored it. */
export function recapDocument(view: FixtureRoomView, recap: FixtureRecapView): FixtureDocument {
  const c = recap.content;
  return {
    kind: "recap",
    title: "Fixture Recap",
    subtitle: `${dash(c.cargo.commodity)} / ${dash(c.vessel.name)}`,
    meta: [
      ["Reference", `${c.ref} · recap v${recap.versionNo}`],
      ["Status", statusText(String(c.status))],
      ["Published", `${docStamp(recap.publishedAt)} by ${dash(recap.publishedByLabel)}`],
      ["Acknowledged", recap.acknowledgedByAllPrincipals ? "by both principals" : `${recap.acknowledgements.length} of 2 principals`],
    ],
    sections: [
      { title: "The fixture", table: { columns: ["Item", "Detail"], widths: [28, 72], rows: [
        ["Cargo", `${dash(c.cargo.commodity)} · ${dash(c.cargo.qtyMin)}–${dash(c.cargo.qtyMax)} MT`],
        ["Route", `${dash(c.cargo.loadPort)} → ${dash(c.cargo.dischPort)}`],
        ["Vessel", `${dash(c.vessel.name)} · ${dash(c.vessel.type)}${c.vessel.dwt != null ? ` · ${Number(c.vessel.dwt).toLocaleString("en-US")} DWT` : ""}`],
      ] } },
      { title: "Parties", table: { columns: ["Side", "Party"], widths: [28, 72], rows: c.parties.map((p) => [p.label, p.name ?? "withheld · via Arab ShipBroker"]) } },
      { title: "Main terms", table: { columns: ["#", "Term", "Agreed", "Status"], widths: [6, 30, 46, 18], rows: [...c.terms].sort((a, b) => a.sortOrder - b.sortOrder).map((t) => [
        String(t.sortOrder), t.label,
        t.status === "agreed" ? dash(t.agreedValue) : `cargo ${dash(t.cargoPosition)} · vessel ${dash(t.vesselPosition)}`,
        statusText(t.status),
      ]) } },
      { title: "Subjects", table: c.subjects.length
        ? { columns: ["Subject", "Responsible", "Deadline", "Status"], widths: [44, 18, 22, 16], rows: c.subjects.map((s) => [s.title, s.responsibleSide ? `${s.responsibleSide} side` : "either side", docStamp(s.deadlineAt), statusText(s.status)]) }
        : undefined, lines: c.subjects.length ? undefined : ["None recorded · the fixture is clean on agreement."] },
      { title: "Acknowledgements", lines: recap.acknowledgements.length
        ? recap.acknowledgements.map((a) => `${a.label} · ${docStamp(a.at)}${a.relayed ? " · recorded by Arab ShipBroker on their behalf" : ""}`)
        : ["Awaiting acknowledgement."] },
    ],
    footer: [
      `Counterparty identity: ${c.counterpartyDisclosed ? "disclosed by both principals" : "withheld · via Arab ShipBroker"}.`,
      "Sub all terms / details of C/P otherwise as per owners' proforma.",
      `Recap v${recap.versionNo} of ${c.ref} · room version ${recap.roomVersion} · content hash ${recap.contentHash}${recap.invalidatedAt ? ` · superseded ${docStamp(recap.invalidatedAt)}` : ""}.`,
    ],
    fileName: `Fixture-${c.ref}-recap-v${recap.versionNo}.pdf`,
  };
}

/** The Negotiation Summary: every term's rounds so far, subjects and state, from the viewer's masked view. */
export function summaryDocument(view: FixtureRoomView, at = new Date()): FixtureDocument {
  const { room, snapshot, terms, proposals, subjects, parties } = view;
  const cargo = snapshot.cargo, vessel = snapshot.vessel.vessel;
  const principals = parties.filter((p) => p.capacity === "principal" && (p.side === "cargo" || p.side === "vessel"));
  const byTerm = [...terms].sort((a, b) => a.sortOrder - b.sortOrder);
  const history: DocSection[] = byTerm.filter((t) => proposals.some((p) => p.termId === t.id)).map((t) => ({
    title: `${t.sortOrder} · ${t.label}${t.status === "agreed" ? ` · agreed ${dash(t.agreed?.displayValue)}` : ""}`,
    table: { columns: ["Round", "When", "Side", "Move", "Figure", "Note"], widths: [8, 20, 18, 10, 20, 24], rows: proposals
      .filter((p) => p.termId === t.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((p) => [`R${p.round}`, docStamp(p.createdAt), p.label, p.kind.toUpperCase() + (p.isFinal ? " · final" : ""), p.displayValue, [p.comment, p.lapsed ? "lapsed" : null].filter(Boolean).join(" · ") || "—"]) },
  }));
  return {
    kind: "summary",
    title: "Negotiation Summary",
    subtitle: `${dash(cargo.commodity_name)} / ${snapshot.vesselIdentityMasked ? "vessel withheld" : dash(vessel.vessel_name)}`,
    meta: [
      ["Reference", `${room.ref} · room version ${room.version}`],
      ["Status", statusText(room.status)],
      ["Generated", docStamp(at.toISOString())],
      ["Agreed", `${terms.filter((t) => t.status === "agreed").length} of ${terms.length} terms`],
    ],
    sections: [
      { title: "The deal", table: { columns: ["Item", "Detail"], widths: [28, 72], rows: [
        ["Cargo", `${dash(cargo.commodity_name)} · ${dash(cargo.qty_min_mt)}–${dash(cargo.qty_max_mt)} MT`],
        ["Route", `${dash(cargo.load_port_name ?? cargo.load_port_locode)} → ${dash(cargo.disch_port_name ?? cargo.disch_port_locode)}`],
        ["Vessel", snapshot.vesselIdentityMasked ? `withheld · ${dash(vessel.vessel_type)}` : `${dash(vessel.vessel_name)} · ${dash(vessel.vessel_type)}`],
        ...principals.map((p): string[] => [p.side === "cargo" ? "Cargo side" : "Vessel side", p.name ?? `${p.label} · via Arab ShipBroker`]),
      ] } },
      { title: "Main terms", table: { columns: ["#", "Term", "Cargo side", "Vessel side", "State"], widths: [6, 26, 24, 24, 20], rows: byTerm.map((t) => [
        String(t.sortOrder), t.label,
        t.status === "agreed" ? dash(t.agreed?.displayValue) : dash(t.cargoPosition?.displayValue),
        t.status === "agreed" ? dash(t.agreed?.displayValue) : dash(t.vesselPosition?.displayValue),
        t.status === "agreed" ? "AGREED" : `${statusText(t.status)}${t.round ? ` · R${t.round}` : ""}`,
      ]) } },
      ...history,
      { title: "Subjects", table: subjects.length
        ? { columns: ["Subject", "Responsible", "Status"], widths: [56, 22, 22], rows: subjects.map((s) => [s.title, s.responsibleSide ? `${s.responsibleSide} side` : "either side", statusText(s.status)]) }
        : undefined, lines: subjects.length ? undefined : ["None recorded."] },
    ],
    footer: [
      "A working summary of the negotiation, not a recap: only a published recap version records the fixture.",
      `Counterparty identity: ${room.counterpartyDisclosed ? "disclosed by both principals" : "withheld · via Arab ShipBroker"}.`,
    ],
    fileName: `Fixture-${room.ref}-negotiation-summary.pdf`,
  };
}
