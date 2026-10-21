// The design's RecordShell (owner B2ALL-061): top bar → record tabs → rail + head + numbered sections. One
// implementation for every record page (Tariff Pack, Port Particulars), in its published, read-only form: tabs and
// rail items are links so a plain server render can address every tab; head meta and fields are definition lists;
// a slot no table holds yet says "Not recorded yet" rather than showing a guess.
import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import type * as React from "react";

import "./pda-route-estimator.css";
import "./ports-module.css";

export const NR = "Not recorded yet";
export const day = (iso: string | null | undefined) => (iso ? new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : null);

export type PdaRecordSection = { n: string; id: string; title: string; src: string; note?: string; body: React.ReactNode };
export type PdaRecordTab<Id extends string = string> = { id: Id; label: string; icon: React.ComponentType<{ size?: number; "aria-hidden"?: boolean }> };
export type PdaRecordMeta = { k: string; v: string | null; empty?: boolean };

export function PdaRecordShell({ back, crumbs, tabs, tab, tabHref, eyebrow, title, sub, seal, meta, trust, railFoot, sections }: {
  back: { href: string; label: string };
  crumbs: React.ReactNode;
  tabs: readonly PdaRecordTab[];
  tab: string;
  tabHref: (id: string) => string;
  eyebrow: string;
  title: string;
  sub: string;
  seal: React.ReactNode;
  meta: PdaRecordMeta[];
  trust: React.ReactNode;
  railFoot: string;
  sections: PdaRecordSection[];
}) {
  const showRail = sections.length >= 3;
  return (
    <div className="asb-ds pm-scope pda-route pda-route--comfortable">
      <div className="pd-topbar">
        <Link className="pd-back" href={back.href}><ArrowLeft size={15} aria-hidden="true" /> {back.label}</Link>
        <div className="pd-crumbs">{crumbs}</div>
        <span className="pdr-role pd-topbar__end">Published record</span>
      </div>

      <nav className="pp-tabs" aria-label="Record tabs">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <Link key={t.id} className={`pp-tab${t.id === tab ? " is-on" : ""}`} href={tabHref(t.id)} aria-current={t.id === tab ? "page" : undefined}>
              <Icon size={15} aria-hidden={true} />{t.label}
            </Link>
          );
        })}
      </nav>

      <div className={`pdr-wrap${showRail ? "" : " is-norail"}`}>
        {showRail ? (
          <aside className="pdr-rail" aria-label="Sections on this tab">
            <div className="pdr-rail__h">{tabs.find((t) => t.id === tab)?.label}</div>
            <div className="pdr-rail__list">
              {sections.map((s) => (
                <a key={s.id} className="pdr-rail__item" href={`#sec-${s.id}`}>
                  <span className="pdr-rail__n">{s.n}</span><span className="pdr-rail__t">{s.title}</span>
                </a>
              ))}
            </div>
            <div className="pdr-rail__foot">{railFoot}</div>
          </aside>
        ) : null}

        <div>
          <header className="pdr-head">
            <div className="pdr-head__band">
              <div className="pdr-head__seal" aria-hidden="true">{seal}</div>
              <div>
                <div className="pdr-head__ey">{eyebrow}</div>
                <h1 className="pdr-head__title">{title}</h1>
                <div className="pdr-head__sub">{sub}</div>
              </div>
            </div>
            <dl className="pdr-head__meta">
              {meta.map((m) => <Meta key={m.k} {...m} />)}
            </dl>
          </header>

          <div className="pdr-trust">
            <span className="pdr-access__ic"><ShieldCheck size={15} aria-hidden="true" /></span>
            <span className="pdr-trust__t">{trust}</span>
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

function Meta({ k, v, empty }: PdaRecordMeta) {
  return <div className="pdr-head__mi"><dt className="k">{k}</dt><dd className={`v${empty || !v ? " is-empty" : ""}`}>{v ?? "-"}</dd></div>;
}

/** A block of label/value slots; a null value is an honest empty slot. */
export function Fields({ title, rows }: { title?: string; rows: Array<[string, React.ReactNode | null]> }) {
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

export function Empty({ what }: { what: string }) {
  return <p className="pdr-sec__note pdr-empty">{NR}. {what}</p>;
}

export function Table({ caption, cols, num = [], rows, wide }: { caption: string; cols: string[]; num?: number[]; rows: React.ReactNode[][]; wide?: boolean }) {
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

/** The design's verification protocol, the same on every record. */
export function Protocol({ extracted }: { extracted: string }) {
  return (
    <ul className="pdr-proto">
      <li><span className="pp-dot is-empty" aria-hidden="true"></span><b>Empty</b> No value yet. Nobody has claimed it.</li>
      <li><span className="pp-dot is-extracted" aria-hidden="true"></span><b>Read from the record</b> {extracted}</li>
      <li><span className="pp-dot is-review" aria-hidden="true"></span><b>Under review</b> An expert has it open.</li>
      <li><span className="pp-dot is-verified" aria-hidden="true"></span><b>Verified</b> A named person confirmed it against a named document on a date.</li>
      <li><span className="pp-dot is-disputed" aria-hidden="true"></span><b>Disputed</b> The document says two things, or two sources disagree. Both kept, neither published.</li>
      <li><span className="pp-dot is-superseded" aria-hidden="true"></span><b>Superseded</b> A newer edition replaced it. The old value stays in history.</li>
    </ul>
  );
}

/** The stop page when a reference names nothing: said out loud, never answered with another record. */
export function RecordMissing({ eyebrow, title, text, back }: { eyebrow: string; title: string; text: string; back: { href: string; label: string } }) {
  return (
    <div className="asb-ds pm-scope pda-route pda-route--comfortable">
      <div className="pdr-missing">
        <div className="pdr-missing__ey">{eyebrow}</div>
        <h1 className="pdr-missing__t">{title}</h1>
        <p>{text} <Link href={back.href}>{back.label}</Link>.</p>
      </div>
    </div>
  );
}
