// PDA · export of a SAVED estimate set (owner ruling O2ALL-008, increment A). SERVER ONLY.
//
// Only an immutable saved set is exported — never a live preview — so a PDF always matches a record. It is laid out
// and written by the Fixture Room's deterministic Unicode PDF engine (HarfBuzz shaping, bidi, embedded Noto fonts,
// subset): the same saved set gives the same bytes. It shows the set's content fingerprint, never an internal id
// (C2O-126), and evidence by title/page/sheet only (C2O-120).
import "server-only";
import { createHash } from "node:crypto";

import { docStamp, type FixtureDocument } from "@/lib/fixture-room/documents";
import { assemblePdf, loadPdfUnicode } from "@/lib/fixture-room/pdf-unicode";
import { layoutDocument } from "@/lib/fixture-room/recap-pdf";
import type { PdaEstimateSetDetail, PdaSavedLeg } from "./estimate-sets";

function money(value: number | null | undefined, currency: string): string {
  if (value == null || !Number.isFinite(value)) return "NOT SOURCED";
  return `${currency} ${new Intl.NumberFormat("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;
}

function days(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "—" : `${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 }).format(value)} d`;
}

/** A leg's total as the route recorded it: complete, known but incomplete, or NOT SOURCED — never an unknown as zero. */
function legTotal(complete: number | null | undefined, known: number | null | undefined, currency: string): string {
  if (complete != null) return money(complete, currency);
  if (known != null) return `${money(known, currency)} (known, incomplete)`;
  return "NOT SOURCED";
}

function legSection(title: string, leg: PdaSavedLeg, displayCurrency: string, complete: number | null | undefined, known: number | null | undefined): FixtureDocument["sections"][number] {
  const converted = leg.convertedCurrency && leg.convertedCurrency !== leg.nativeCurrency;
  const rows = leg.lines.map((line) => {
    const evidence = [line.evidence.title, line.evidence.page ? `p. ${line.evidence.page}` : null, line.evidence.sheet ? `sheet ${line.evidence.sheet}` : null]
      .filter(Boolean).join(" · ");
    const provenance = line.manual
      ? `Manual quote${line.enteredBy ? ` by ${line.enteredBy}` : ""}${line.manualReason ? ` · ${line.manualReason}` : ""}`
      : evidence || "Published tariff";
    return [
      line.label,
      `${line.explanation}${provenance ? ` (${provenance})` : ""}`,
      money(line.amount, leg.nativeCurrency),
      converted ? money(line.convertedAmount, leg.convertedCurrency!) : "—",
    ];
  });
  return {
    title: `${title} · ${leg.portLocode}${leg.terminalName ? ` · ${leg.terminalName}` : ""}`,
    table: {
      columns: ["Charge", "Basis and evidence", leg.nativeCurrency || "Native", converted ? leg.convertedCurrency! : displayCurrency],
      rows: rows.length ? rows : [["No priced line", "NOT SOURCED — no published tariff line or attributed quote", "—", "—"]],
      widths: [3, 7, 2.2, 2.2],
    },
    lines: [
      leg.editionLabel ? `Published tariff: ${leg.editionLabel}` : "No published tariff in force: every figure here is an attributed quote or NOT SOURCED",
      `Coverage: ${leg.coverage.replace(/_/g, " ")}`,
      leg.lines.length === 0
        ? "Port total: NOT SOURCED (no governed line or attributed quote)"
        : `Port total: ${legTotal(complete, known, displayCurrency)}${leg.nativeTotal != null && leg.nativeCurrency !== displayCurrency ? ` · native ${complete != null ? "" : "known "}${money(leg.nativeTotal, leg.nativeCurrency)}` : ""}`,
    ],
  };
}

/** The document of one saved set (pure: the same set always gives the same document). */
export function pdaEstimateSetDocument(set: PdaEstimateSetDetail): FixtureDocument {
  const c = set.displayCurrency;
  const t = set.totals;
  const transitLines = set.transits.length
    ? set.transits.map((transit) => `${transit.label}: ${transit.amountUsd == null ? "NOT SOURCED" : money(transit.amountUsd, "USD")} — ${transit.note}`)
    : ["No canal or strait transit on the measured route."];
  return {
    kind: "summary",
    title: "Port Disbursement Estimate",
    subtitle: set.title,
    meta: [
      ["Saved", docStamp(set.createdAt)],
      ["Version", set.isLatest ? (set.supersedesId ? "Latest (supersedes an earlier version)" : "Latest") : "Superseded by a newer version"],
      ["Fingerprint", `${set.contentHash.slice(0, 16)}…`],
      ["Quantity", `${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 3 }).format(set.quantityMt)} MT`],
      ["Allocation", set.allocation === "charterer" ? "Charterer pays port costs" : "Vessel pays port costs"],
      ["Currency", c],
    ],
    sections: [
      {
        title: "Totals",
        table: {
          columns: ["Item", "Amount"],
          rows: [
            ["Load port", legTotal(t.loadPort, t.loadPortKnown, c)],
            ["Discharge port", legTotal(t.dischargePort, t.dischargePortKnown, c)],
            ["Canal and strait transits", money(t.transit, c)],
            ["All in, known", t.allInKnown != null && t.allInComplete == null ? `${money(t.allInKnown, c)} (incomplete)` : money(t.allInKnown, c)],
            ["All in, complete", money(t.allInComplete, c)],
            ["Voyage OPEX", money(t.voyageOpex, c)],
          ],
          widths: [6, 4],
        },
      },
      {
        title: "Voyage timeline",
        table: {
          columns: ["Stage", "Value"],
          rows: [
            ["ETA load port", docStamp(set.timeline.etaLoad)],
            ["Days at load port", days(set.timeline.loadPortDays)],
            ["ETD load port", docStamp(set.timeline.etdLoad)],
            ["Passage", days(set.timeline.passageDays)],
            ["ETA discharge port", docStamp(set.timeline.etaDischarge)],
            ["Days at discharge port", days(set.timeline.dischargePortDays)],
          ],
          widths: [6, 4],
        },
      },
      legSection("Load port", set.load, c, t.loadPort, t.loadPortKnown),
      legSection("Discharge port", set.discharge, c, t.dischargePort, t.dischargePortKnown),
      { title: "Transits", lines: transitLines },
      {
        title: "Not sourced",
        lines: set.notSourced.length
          ? set.notSourced.map((item) => `${item.label}: ${item.message}`)
          : ["Every requested item has a governed figure."],
      },
    ],
    footer: [
      "Every figure comes from the published tariff edition named with its port or from an attributed quote. Items marked NOT SOURCED have no governed figure and are excluded from complete totals; nothing is estimated in their place.",
      "This is an estimate, not an invoice. Final disbursements are settled with the appointed agent.",
    ],
    fileName: `PDA ${set.route.loadPort}-${set.route.dischargePort} ${set.createdAt.slice(0, 10)}.pdf`.replace(/\s+/g, " "),
  };
}

/** Render a saved set. The same set gives the same bytes and SHA-256. Throws if any text cannot be set exactly. */
export async function renderPdaEstimateSetPdf(set: PdaEstimateSetDetail): Promise<{ bytes: Uint8Array; sha256: string; fileName: string }> {
  await loadPdfUnicode();
  const doc = pdaEstimateSetDocument(set);
  const pages = layoutDocument(doc, `PDA ${set.contentHash.slice(0, 12)}`);
  const bytes = assemblePdf(pages, { title: `Port Disbursement Estimate · ${set.title}`, createdAt: set.createdAt, idHex: set.contentHash, subsetFonts: true });
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex"), fileName: doc.fileName };
}
