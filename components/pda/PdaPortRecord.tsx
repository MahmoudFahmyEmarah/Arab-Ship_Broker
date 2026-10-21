// The design's Port Particulars record (owner B2ALL-061, build step 8) on the shared RecordShell: one page per port,
// arms as tabs. Everything shown is read from the port, its tariffs in force, the packs that price it and the
// agencies listed at it; the slots no store holds yet say "Not recorded yet".
import Link from "next/link";
import { FileText, Receipt, Ship, ShieldCheck, UserRound } from "lucide-react";

import {
  PDA_PORT_RECORD_TABS,
  identityRows,
  marketRows,
  pdaInputRows,
  portAgents,
  portPacks,
  portRecordMeta,
  positionRows,
  regimeRows,
  tariffBindingRows,
  terminalRows,
  type PdaPortRecordInput,
  type PdaPortRecordTab,
} from "@/lib/pda/port-record";

import { Empty, Fields, PdaRecordShell, Protocol, Table, type PdaRecordSection, type PdaRecordTab } from "./PdaRecordShell";

const ICON = { particulars: FileText, operations: Ship, costs: Receipt, commercial: UserRound, sources: ShieldCheck } as const;
const TABS: readonly PdaRecordTab<PdaPortRecordTab>[] = PDA_PORT_RECORD_TABS.map((t) => ({ ...t, icon: ICON[t.id] }));

export function PdaPortRecord({ input, tab }: { input: PdaPortRecordInput; tab: PdaPortRecordTab }) {
  const { port, on } = input;
  const base = `/dashboard/ports-da/ports/${port.locode}`;
  return (
    <PdaRecordShell
      back={{ href: "/dashboard/ports-da?tab=ports", label: "Ports" }}
      crumbs={<>Ports Module · Ports · <b>{port.name}</b></>}
      tabs={TABS}
      tab={tab}
      tabHref={(id) => `${base}?on=${on}&tab=${id}`}
      eyebrow="Port record · one per port"
      title={port.name}
      sub={[port.locode, port.country, port.zone].filter(Boolean).join(" · ")}
      seal={<span>Port<br />seal</span>}
      meta={portRecordMeta(input)}
      trust={<>
        <b>Every figure here is read from a published record</b>: the port registry, the tariffs in force on the date, and the
        agency registry Arab ShipBroker curates. Nothing on this page is typed in by hand, so a slot nobody has filled stays
        empty rather than showing a guess.
      </>}
      railFoot="Published values only. One record per port; terminals and tariff editions are its arms, and the tariff lines live on the pack record."
      sections={sectionsFor(tab, input)}
    />
  );
}

function sectionsFor(tab: PdaPortRecordTab, input: PdaPortRecordInput): PdaRecordSection[] {
  const { port, packs, agents, on } = input;
  if (tab === "particulars") {
    return [
      {
        n: "01", id: "identity", title: "Identity & codes", src: "Port registry",
        note: "The registry line. Stable, single-valued, citable: what a broker screenshots into an offer.",
        body: (
          <>
            <Fields title="Names & codes" rows={identityRows(port)} />
            <Fields title="Position & navigation reference" rows={positionRows(port)} />
            <Fields title="Working & access regime" rows={regimeRows()} />
          </>
        ),
      },
    ];
  }
  if (tab === "operations") {
    const terminals = terminalRows(port);
    return [
      { n: "02", id: "anchorage", title: "Anchorages", src: "Agent document", body: <Empty what="No anchorage area is recorded for this port." /> },
      { n: "03", id: "approach", title: "Approach, depths & draught rules", src: "Agent document", body: <Empty what="Approach channel, depths and draught rules are not recorded for this port." /> },
      {
        n: "04", id: "terminals", title: "Terminals & berths", src: "Port registry",
        note: "The verified terminals Arab ShipBroker lists at this port, and which tariff edition prices each. Operators, berth lists and rates are not recorded yet.",
        body: terminals.length ? (
          <>
            <Table caption="Terminals" cols={["Terminal", "Operator / concession", "Terminal type", "Max vessel size", "Priced by"]}
              rows={terminals.map((r) => [<span key="t" className="pp-val">{r[0]}</span>, r[1], r[2], r[3], r[4]])} />
            <Empty what="Berth list, berth criteria and performance (load and discharge rates, gangs, waiting) are not recorded for these terminals." />
          </>
        ) : <Empty what="No verified terminal is listed; port-wide tariffs apply to the whole port." />,
      },
      { n: "05", id: "equipment", title: "Equipment & marine craft", src: "Agent document", body: <Empty what="Cranes, tugs and marine craft are not recorded for this port." /> },
      { n: "06", id: "services", title: "Services & permissions", src: "Agent document", body: <Empty what="Bunkering, fresh water, waste and permissions are not recorded for this port." /> },
      { n: "07", id: "layout", title: "Port map & layout", src: "Agent document", body: <Empty what="No port plan is held for this port; the Ports map shows its position only." /> },
    ];
  }
  if (tab === "costs") {
    const bindings = tariffBindingRows(port, packs);
    const packsHere = portPacks(packs, port.locode);
    return [
      {
        n: "08", id: "tariff", title: "Tariff binding", src: "Arab ShipBroker · feeds the PDA",
        note: "Rates live in the tariff pack; this is the port's binding to it. Open a pack for its charge lines.",
        body: bindings.length ? (
          <>
            <Table wide caption="Tariff editions in force at this port" cols={["Edition", "Scope", "Publisher", "Currency", "In force", "Charge lines", "Services priced", "Pack record"]} num={[5]}
              rows={bindings.map((b) => [
                <span key="e" className="pp-val">{b.edition}</span>, b.scope, b.publisher, b.currency, b.period, String(b.lines), b.services || null,
                b.packRef ? <Link key="p" href={`/dashboard/ports-da/tariff-packs/${b.packRef}?on=${on}`}>Open the pack</Link> : null,
              ])} />
            <Fields title="Pack & basis" rows={[
              ["Tariff packs", packsHere.length ? packsHere.map((k) => k.authority).join(" · ") : null],
              ["Tariff currency", [...new Set(port.tariffs.map((t) => t.currency))].join(" / ") || null],
              ["Charge basis", null],
              ["Last tariff revision", port.tariffs.map((t) => t.publishedAt).filter(Boolean).sort().at(-1)?.slice(0, 10) ?? null],
              ["VAT / levy applied", null],
              ["FX source & date", null],
            ]} />
          </>
        ) : <Empty what="No published tariff is in force at this port on this date; every service needs a manual quote in the estimate." />,
      },
      {
        n: "09", id: "pdainputs", title: "PDA inputs — the handover to Arm 1", src: "Arab ShipBroker · derived, not typed",
        note: "The short list the estimator actually consumes. Everything else on this page is context; these are the numbers that move the estimate.",
        body: <Table caption="Inputs the estimator reads" cols={["Input", "Comes from", "Feeds"]}
          rows={pdaInputRows(port).map((r) => [<span key="i" className="pp-val">{r[0]}</span>, r[1], r[2]])} />,
      },
    ];
  }
  if (tab === "commercial") {
    const rows = portAgents(agents, port.locode);
    return [
      {
        n: "10", id: "agents", title: "Attending agents", src: "Arab ShipBroker · agency registry",
        note: "Agencies Arab ShipBroker has invited and listed at this port, with the services each quotes here. Ask them for a quote from the Agents tab of the estimator.",
        body: rows === null ? <Empty what="The agency registry is not readable on this database yet (it ships with the Agents wave)." />
          : rows.length ? (
            <Table caption="Attending agents" cols={["Agency", "HQ", "Verified", "Scope", "Contact"]}
              rows={rows.map((a) => [
                <span key="n" className="pp-val">{a.name}</span>, null, "Invited by Arab ShipBroker", a.services.join(" · ") || null,
                a.website ? <a key="w" href={a.website} rel="noopener noreferrer" target="_blank">website</a> : null,
              ])} />
          ) : <Empty what="No agency is listed at this port yet." />,
      },
      { n: "11", id: "market", title: "Market conditions", src: "Arab ShipBroker", body: <Fields rows={marketRows()} /> },
    ];
  }
  return [
    {
      n: "12", id: "documents", title: "Source documents", src: "Arab ShipBroker",
      body: port.tariffs.length ? (
        <Table caption="Source documents" cols={["Document", "Issuing body", "Scope", "Lines extracted"]} num={[3]}
          rows={port.tariffs.map((t) => [<span key="d" className="pp-val">{t.editionLabel}</span>, t.publisherName, t.terminalName ?? "Port-wide", String(t.ruleCount)])} />
      ) : <Empty what="No source document is registered for this port." />,
    },
    {
      n: "13", id: "protocol", title: "Verification protocol", src: "Arab ShipBroker, applies to every slot on every tab",
      body: <Protocol extracted="Taken from the port registry, a published tariff or the agency registry; shown, but not yet confirmed by a named person." />,
    },
  ];
}
