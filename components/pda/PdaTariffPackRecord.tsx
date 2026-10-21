// The design's Tariff Pack record (owner B2ALL-061, build step 7): the RecordShell (top bar → record tabs → rail +
// head + numbered sections) in its published, read-only form. Every value comes from get_pda_tariff_pack; a slot no
// table holds yet says "Not recorded yet" rather than showing a guess. The tab is in the URL, so the page is a plain
// server render and each tab can be linked.
import Link from "next/link";
import { ArrowLeft, Clock, FileText, LayoutList, Receipt, ShieldCheck } from "lucide-react";
import type * as React from "react";

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

import "./pda-route-estimator.css";
import "./ports-module.css";

const TAB_ICON: Record<PdaTariffPackTab, React.ComponentType<{ size?: number; "aria-hidden"?: boolean }>> = {
  pack: FileText, layout: LayoutList, charges: Receipt, hours: Clock, sources: ShieldCheck,
};
const SOURCE_KIND: Record<string, string> = {
  official: "Official publication", statutory: "Statutory instrument", agent: "Agent's schedule", reference: "Reference copy", unverified: "Not yet graded",
};
const ROUNDING: Record<string, string> = { half_up: "Half up", up: "Always up", down: "Always down" };
const day = (iso: string | null) => (iso ? new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : null);
const NR = "Not recorded yet";

type Section = { n: string; id: string; title: string; src: string; note?: string; body: React.ReactNode };

export function PdaTariffPackRecord({ record, tab, on }: { record: Record_; tab: PdaTariffPackTab; on: string }) {
  const totals = packTotals(record);
  const base = `/dashboard/ports-da/tariff-packs/${record.packRef}`;
  const sections = sectionsFor(tab, record, totals);
  const showRail = sections.length >= 3;
  const portNames = [...new Set(record.editions.map((e) => e.portName))];
  const earliest = record.editions.map((e) => e.effectiveFrom).filter((d): d is string => !!d).sort()[0] ?? record.source.effectiveFrom;

  return (
    <div className="asb-ds pm-scope pda-route pda-route--comfortable">
      <div className="pd-topbar">
        <Link className="pd-back" href={`/dashboard/ports-da/tariff-packs?on=${on}`}><ArrowLeft size={15} aria-hidden="true" /> Tariff Packs</Link>
        <div className="pd-crumbs">Ports Module · Tariff Packs · <b>{record.authority}</b></div>
        <span className="pdr-role pd-topbar__end">Published record</span>
      </div>

      <nav className="pp-tabs" aria-label="Record tabs">
        {PDA_TARIFF_PACK_TABS.map((t) => {
          const Icon = TAB_ICON[t.id];
          return (
            <Link key={t.id} className={`pp-tab${t.id === tab ? " is-on" : ""}`} href={`${base}?on=${on}&tab=${t.id}`} aria-current={t.id === tab ? "page" : undefined}>
              <Icon size={15} aria-hidden={true} />{t.label}
            </Link>
          );
        })}
      </nav>

      <div className={`pdr-wrap${showRail ? "" : " is-norail"}`}>
        {showRail ? (
          <aside className="pdr-rail" aria-label="Sections on this tab">
            <div className="pdr-rail__h">{PDA_TARIFF_PACK_TABS.find((t) => t.id === tab)?.label}</div>
            <div className="pdr-rail__list">
              {sections.map((s) => (
                <a key={s.id} className="pdr-rail__item" href={`#sec-${s.id}`}>
                  <span className="pdr-rail__n">{s.n}</span><span className="pdr-rail__t">{s.title}</span>
                </a>
              ))}
            </div>
            <div className="pdr-rail__foot">Published values only. Anything not published is not shown. One record per published tariff; a new edition is a new record.</div>
          </aside>
        ) : null}

        <div>
          <header className="pdr-head">
            <div className="pdr-head__band">
              <div className="pdr-head__seal" aria-hidden="true"><span>Authority<br />crest</span></div>
              <div>
                <div className="pdr-head__ey">Tariff pack · authority scoped</div>
                <h1 className="pdr-head__title">{record.authority}</h1>
                <div className="pdr-head__sub">{[record.source.title, totals.currencies.join(" / ") || null, `${portNames.length} port${portNames.length === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}</div>
              </div>
            </div>
            <dl className="pdr-head__meta">
              <Meta k="Effective from" v={day(earliest)} />
              <Meta k="Charge lines" v={String(totals.lines)} />
              <Meta k="Verified slots" v={`0 of ${totals.lines}`} empty />
              <Meta k="Read from the document" v={`${totals.lines} line${totals.lines === 1 ? "" : "s"}`} />
              <Meta k="Open findings" v="none recorded" empty />
              <Meta k="Source kind" v={SOURCE_KIND[record.source.authority] ?? record.source.authority} />
            </dl>
          </header>

          <div className="pdr-trust">
            <span className="pdr-access__ic"><ShieldCheck size={15} aria-hidden="true" /></span>
            <span className="pdr-trust__t">
              <b>Every rate here is the authority&apos;s own published figure</b>, read from the document named on the Sources tab and
              published by Arab ShipBroker after a maker-checker review. No line has been verified by a named person yet, so each one
              is shown as read from the document.
            </span>
          </div>

          {sections.map((s) => (
            <section key={s.id} className="pdr-sec" id={`sec-${s.id}`} aria-labelledby={`sec-${s.id}-h`}>
              <div className="pdr-sec__hd">
                <span className="pdr-sec__n" aria-hidden="true">{s.n}</span>
                <h2 id={`sec-${s.id}-h`} className="pdr-sec__h">{s.title}</h2>
                <span className="pdr-flag">{s.src}</span>
              </div>
              <div className="pdr-sec__body">
                {s.note ? <p className="pdr-sec__note">{s.note}</p> : null}
                {s.body}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function Meta({ k, v, empty }: { k: string; v: string | null; empty?: boolean }) {
  return <div className="pdr-head__mi"><dt className="k">{k}</dt><dd className={`v${empty || !v ? " is-empty" : ""}`}>{v ?? "-"}</dd></div>;
}

function Fields({ title, rows }: { title?: string; rows: Array<[string, React.ReactNode | null]> }) {
  return (
    <div className="pdr-blk">
      {title ? <div className="pdr-blk__hd"><span className="pdr-blk__t">{title}</span></div> : null}
      <dl className="pdr-fields">
        {rows.map(([k, v]) => (
          <div key={k} className="pdr-f">
            <dt className="pdr-f__k">{k}</dt>
            <dd className="pdr-f__v">
              <span className={`pp-dot ${v == null ? "is-empty" : "is-extracted"}`} aria-hidden="true"></span>
              <span className={`pp-val${v == null ? " is-empty" : ""}`}>{v ?? NR}</span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Empty({ what }: { what: string }) {
  return <p className="pdr-sec__note pdr-empty">{NR}. {what}</p>;
}

function Table({ caption, cols, num = [], rows, wide }: { caption: string; cols: string[]; num?: number[]; rows: React.ReactNode[][]; wide?: boolean }) {
  return (
    <div className={`pdr-blk${wide ? " pp-scrollx" : ""}`}>
      <table className="pdr-tbl pdr-tbl--filled">
        <caption className="asb-sr-only">{caption}</caption>
        <thead><tr>{cols.map((c, i) => <th key={c} scope="col" className={num.includes(i) ? "num" : undefined}>{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, ri) => <tr key={ri}>{r.map((cell, ci) => <td key={ci} className={num.includes(ci) ? "num" : undefined}>{cell ?? <span className="pp-val is-empty">-</span>}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}

function sectionsFor(tab: PdaTariffPackTab, record: Record_, totals: ReturnType<typeof packTotals>): Section[] {
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
            rows={record.editions.map((e) => [<span key="p" className="pp-val">{e.portName}</span>, e.port, e.terminal ?? "Port-wide", e.edition, String(e.lines.length)])} />
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
              <div key={`${e.port}-${e.terminal ?? ""}`} className="pdr-blk">
                <div className="pdr-blk__hd">
                  <span className="pdr-blk__t">{e.portName}{e.terminal ? ` · ${e.terminal}` : " · port-wide"}</span>
                  <span className="pdr-blk__hint">{e.edition} · {e.currency} · from {day(e.effectiveFrom) ?? "-"}{e.effectiveTo ? ` to ${day(e.effectiveTo)}` : ""}</span>
                </div>
                <Table wide caption={`Charge lines, ${e.portName}${e.terminal ? ` ${e.terminal}` : ""}`}
                  cols={["Charge line", "Basis", "Rate", "Minimum", "Maximum", "Tax", "Applies to", "Tariff item", "Status"]} num={[2, 3, 4, 5]}
                  rows={e.lines.map((l) => [
                    <span key="l" className="pp-val" title={l.excerpt ?? undefined}>{l.label}</span>,
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
      body: (
        <ul className="pdr-proto">
          <li><span className="pp-dot is-empty" aria-hidden="true"></span><b>Empty</b> No value yet. Nobody has claimed it.</li>
          <li><span className="pp-dot is-extracted" aria-hidden="true"></span><b>Read from the document</b> Taken from the published tariff and published after a maker-checker review; shown, but not yet confirmed by a named person.</li>
          <li><span className="pp-dot is-review" aria-hidden="true"></span><b>Under review</b> An expert has it open.</li>
          <li><span className="pp-dot is-verified" aria-hidden="true"></span><b>Verified</b> A named person confirmed it against a named document on a date.</li>
          <li><span className="pp-dot is-disputed" aria-hidden="true"></span><b>Disputed</b> The document says two things, or two sources disagree. Both kept, neither published.</li>
          <li><span className="pp-dot is-superseded" aria-hidden="true"></span><b>Superseded</b> A newer edition replaced it. The old value stays in history.</li>
        </ul>
      ),
    },
  ];
}
