// The design's Tariff Pack record (owner B2ALL-061, build step 7) on the shared RecordShell. Every value comes from
// get_pda_tariff_pack; a slot no table holds yet says "Not recorded yet" rather than showing a guess.
import { Clock, FileText, LayoutList, Receipt, ShieldCheck } from "lucide-react";

import {
  PDA_BASIS_LABELS,
  PDA_TARIFF_PACK_TABS,
  lineFigure,
  lineItem,
  lineServices,
  packHandover,
  packTotals,
  type PdaTariffPackRecord as Record_,
  type PdaTariffPackTab,
} from "@/lib/pda/tariff-pack-record";

import { Empty, Fields, PdaRecordShell, Protocol, Table, day, type PdaRecordSection, type PdaRecordTab } from "./PdaRecordShell";

const ICON = { pack: FileText, layout: LayoutList, charges: Receipt, hours: Clock, sources: ShieldCheck } as const;
const TABS: readonly PdaRecordTab<PdaTariffPackTab>[] = PDA_TARIFF_PACK_TABS.map((t) => ({ ...t, icon: ICON[t.id] }));
const SOURCE_KIND: Record<string, string> = {
  official: "Official publication", statutory: "Statutory instrument", agent: "Agent's schedule", reference: "Reference copy", unverified: "Not yet graded",
};
const ROUNDING: Record<string, string> = { half_up: "Half up", up: "Always up", down: "Always down" };

export function PdaTariffPackRecord({ record, tab, on }: { record: Record_; tab: PdaTariffPackTab; on: string }) {
  const totals = packTotals(record);
  const base = `/dashboard/ports-da/tariff-packs/${record.packRef}`;
  const portNames = [...new Set(record.editions.map((e) => e.portName))];
  const earliest = record.editions.map((e) => e.effectiveFrom).filter((d): d is string => !!d).sort()[0] ?? record.source.effectiveFrom;
  return (
    <PdaRecordShell
      back={{ href: `/dashboard/ports-da/tariff-packs?on=${on}`, label: "Tariff Packs" }}
      crumbs={<>Ports Module · Tariff Packs · <b>{record.authority}</b></>}
      tabs={TABS}
      tab={tab}
      tabHref={(id) => `${base}?on=${on}&tab=${id}`}
      eyebrow="Tariff pack · authority scoped"
      title={record.authority}
      sub={[record.source.title, totals.currencies.join(" / ") || null, `${portNames.length} port${portNames.length === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
      seal={<span>Authority<br />crest</span>}
      meta={[
        { k: "Effective from", v: day(earliest) },
        { k: "Charge lines", v: String(totals.lines) },
        { k: "Verified slots", v: `0 of ${totals.lines}`, empty: true },
        { k: "Read from the document", v: `${totals.lines} line${totals.lines === 1 ? "" : "s"}` },
        { k: "Open findings", v: "none recorded", empty: true },
        { k: "Source kind", v: SOURCE_KIND[record.source.authority] ?? record.source.authority },
      ]}
      trust={<>
        <b>Every rate here is the authority&apos;s own published figure</b>, read from the document named on the Sources tab and
        published by Arab ShipBroker after a maker-checker review. No line has been verified by a named person yet, so each one
        is shown as read from the document.
      </>}
      railFoot="Published values only. Anything not published is not shown. One record per published tariff; a new edition is a new record."
      sections={sectionsFor(tab, record, totals)}
    />
  );
}

function sectionsFor(tab: PdaTariffPackTab, record: Record_, totals: ReturnType<typeof packTotals>): PdaRecordSection[] {
  const portCount = new Set(record.editions.map((e) => e.port)).size;
  if (tab === "pack") {
    const versions = [...new Set(record.editions.map((e) => e.edition))];
    const anySupersedes = record.editions.some((e) => e.supersedes);
    const roundings = [...new Set(record.editions.map((e) => `${ROUNDING[e.rounding ?? ""] ?? e.rounding ?? "-"}, ${e.decimals ?? "-"} decimals`))];
    return [
      {
        n: "01", id: "issuer", title: "Issuing authority & document", src: "Tariff cover page",
        note: "The subject of this record is one published document from one authority. A new edition is a new record, and the old one is marked superseded.",
        body: (
          <>
            <Fields title="Authority" rows={[
              ["Issuing authority", record.authority],
              ["Trading name", null],
              ["Scope of the pack", portCount === 1 ? "Single port" : `${portCount} ports`],
              ["Country", record.country],
              ["Authority website", record.website ? <a href={record.website} rel="noopener noreferrer" target="_blank">{new URL(record.website).host}</a> : null],
              ["Tariff enquiries contact", null],
            ]} />
            <Fields title="The document" rows={[
              ["Document title", record.source.title || null],
              ["Issued on", day(record.source.issueDate)],
              ["Effective from", day(record.source.effectiveFrom)],
              ["Version or revision", versions.join(" · ") || null],
              ["Source kind", SOURCE_KIND[record.source.authority] ?? record.source.authority],
              ["Language", record.source.language],
              ["Read into the system on", day(record.source.registeredAt)],
              ["Supersedes", anySupersedes ? "An earlier edition (kept in history)" : "Nothing: a first edition"],
              ["Currentness", record.source.currentness],
            ]} />
          </>
        ),
      },
      {
        n: "02", id: "ports", title: "Ports this pack governs", src: "Tariff scope clauses",
        note: "Pick a port, get the packs that price it. One port can resolve to several packs when terminals are separately concessioned.",
        body: (
          <Table caption="Ports this pack governs" cols={["Port", "UN/LOCODE", "Terminal", "Edition", "Charge lines"]} num={[4]}
            rows={record.editions.map((e) => [<span key="p" className="pp-val">{e.portName}</span>, e.port, e.terminal ?? "Port-wide", e.setName ? `${e.edition} (${e.setName})` : e.edition, String(e.lines.length)])} />
        ),
      },
      {
        n: "03", id: "money", title: "Currency, tax & indexation", src: "Tariff general conditions",
        note: "Stated currency, whether tax sits on top, and whether the rates move with a published index.",
        body: (
          <Fields rows={[
            ["Rates stated in", totals.currencies.join(" / ") || null],
            ["Rounding", roundings.join(" · ")],
            ["Tax on a line", totals.taxed ? "Yes, on the lines that state it (Charges tab)" : null],
            ["Peg to USD", null],
            ["Base year", null],
            ["Escalation applied", null],
            ["Payment terms", null],
          ]} />
        ),
      },
    ];
  }
  if (tab === "layout") {
    return [
      { n: "04", id: "shape", title: "Charge shape", src: "Read across the whole document", body: <Empty what="Whether this pack bundles services into one charge or itemises them is not derived from the published lines yet." /> },
      { n: "05", id: "bundle", title: "What one charge covers", src: "Inclusion clause", body: <Empty what="Needs a bundled pack: the inclusion clause is not held as data." /> },
      { n: "06", id: "notlevied", title: "Not levied, and out of scope", src: "Absence of an item", body: <Empty what="No absence has been recorded against this pack." /> },
    ];
  }
  if (tab === "charges") {
    const handover = packHandover(record);
    return [
      {
        n: "07", id: "lines", title: "Charge lines", src: "Tariff items, per row",
        note: "One row per charge line, as published. Status sits on the row: every line here is read from the document; none is verified by a named person yet.",
        body: (
          <>
            {record.editions.map((e) => (
              <div key={`${e.port}-${e.terminal ?? ""}-${e.scope ?? ""}-${e.setName ?? ""}-${e.edition}`} className="pdr-blk">
                <div className="pdr-blk__hd">
                  <span className="pdr-blk__t">{e.portName}{e.terminal ? ` · ${e.terminal}` : " · port-wide"}{e.setName ? ` · ${e.setName}` : ""}</span>
                  <span className="pdr-blk__hint">{e.edition} · {e.currency} · from {day(e.effectiveFrom) ?? "-"}{e.effectiveTo ? ` to ${day(e.effectiveTo)}` : ""}</span>
                </div>
                <Table wide caption={`Charge lines, ${e.portName}${e.terminal ? ` ${e.terminal}` : ""}`}
                  cols={["Charge line", "Basis", "Rate", "Minimum", "Maximum", "Tax", "Applies to", "Tariff item", "Status"]} num={[2, 3, 4, 5]}
                  rows={e.lines.map((l) => [
                    <span key="l" className="pp-val">{l.label}{l.excerpt ? <small className="pp-excerpt">{l.excerpt}</small> : null}</span>,
                    PDA_BASIS_LABELS[l.basis] ?? l.basis,
                    lineFigure(l, e.currency),
                    l.minimum != null ? `${e.currency} ${l.minimum}` : null,
                    l.maximum != null ? `${e.currency} ${l.maximum}` : null,
                    l.taxPercent != null ? `${l.taxPercent} %` : null,
                    lineServices(l) || null,
                    lineItem(l) || null,
                    <span key="s" className="pp-st"><span className="pp-dot is-extracted" aria-hidden="true"></span> read from the document</span>,
                  ])} />
              </div>
            ))}
          </>
        ),
      },
      { n: "08", id: "multipliers", title: "Multipliers & surcharges", src: "Surcharge clauses", body: <Empty what="Surcharge triggers (overtime, holidays, hazardous cargo) are not held as separate data for this pack." /> },
      {
        n: "09", id: "handover", title: "Handover to the estimator", src: "Derived, not typed",
        note: "What the estimator has to know to price these lines, read from each line's basis.",
        body: <Table caption="Inputs the estimator reads" cols={["Input", "Feeds"]} rows={handover.map((h) => [<span key="i" className="pp-val">{h.input}</span>, h.lines.join(" · ")])} />,
      },
    ];
  }
  if (tab === "hours") {
    return [
      { n: "10", id: "working", title: "Working hours", src: "Working hours clause", body: <Empty what="The working hours clause is not held as data for this pack." /> },
      { n: "11", id: "ordering", title: "Ordering & overtime rules", src: "Labour and ordering clauses", body: <Empty what="Ordering and overtime rules are not held as data for this pack." /> },
      { n: "12", id: "waiting", title: "Cost of waiting", src: "Anchorage and lay-by items", body: <Empty what="Anchorage and lay-by rates are priced only where they appear as charge lines on the Charges tab." /> },
    ];
  }
  return [
    {
      n: "13", id: "documents", title: "Source documents", src: "ASB",
      body: (
        <Table caption="Source documents" cols={["Document", "Issuing body", "Doc date", "Read on", "Lines extracted"]} num={[4]}
          rows={[[<span key="d" className="pp-val">{record.source.title}</span>, record.authority, day(record.source.issueDate), day(record.source.registeredAt), String(totals.lines)]]} />
      ),
    },
    { n: "14", id: "findings", title: "Findings to put to the authority", src: "ASB", body: <Empty what="No finding has been raised against this pack." /> },
    {
      n: "15", id: "protocol", title: "Verification protocol", src: "ASB, applies to every slot on every tab",
      body: <Protocol extracted="Taken from the published tariff and published after a maker-checker review; shown, but not yet confirmed by a named person." />,
    },
  ];
}
