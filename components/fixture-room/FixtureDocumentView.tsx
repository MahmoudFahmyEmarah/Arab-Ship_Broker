"use client";

// The printable rendering of a Fixture document (lib/fixture-room/documents.ts):
// letterhead, meta block, tables, footer. "Save as PDF" is the browser's print
// dialog until the server PDF (same model) replaces it.
import * as React from "react";
import Link from "next/link";
import type { FixtureDocument } from "@/lib/fixture-room/documents";

export function FixtureDocumentView({ doc, backHref, otherHref, otherLabel }: { doc: FixtureDocument; backHref: string; otherHref?: string; otherLabel?: string }) {
  React.useEffect(() => {
    const previous = document.title;
    document.title = doc.fileName.replace(/\.pdf$/, "");   // the browser's "Save as PDF" names the file from the title
    return () => { document.title = previous; };
  }, [doc.fileName]);
  return (
    <div className="nr">
      <div className="nr-print__page">
        <div className="nr-print__acts">
          <Link href={backHref} className="asb-btn">← Back to the room</Link>
          {otherHref && <Link href={otherHref} className="asb-btn">{otherLabel}</Link>}
          <button type="button" className="asb-btn primary" onClick={() => window.print()} data-testid="doc-save-pdf">Save as PDF</button>
        </div>
        <article className="nr-doc" data-testid={doc.kind === "recap" ? "recap-print" : "summary-print"}>
          <header className="nr-doc__head">
            <div className="nr-doc__brand">
              <span className="nr-doc__logo" aria-hidden="true">ASB</span>
              <div>
                <div className="nr-doc__org">Arab ShipBroker</div>
                <div className="nr-doc__tag">Fixture Room</div>
              </div>
            </div>
            <div className="nr-doc__titles">
              <h1>{doc.title}</h1>
              <div className="nr-doc__sub">{doc.subtitle}</div>
            </div>
          </header>
          <dl className="nr-doc__meta">
            {doc.meta.map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>)}
          </dl>
          {doc.sections.map((s) => (
            <section key={s.title} className="nr-doc__sec">
              <h2>{s.title}</h2>
              {s.table && (
                <table className="nr-doc__table">
                  {s.table.widths && <colgroup>{s.table.widths.map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}</colgroup>}
                  <thead><tr>{s.table.columns.map((c) => <th key={c} scope="col">{c}</th>)}</tr></thead>
                  <tbody>{s.table.rows.map((r, i) => <tr key={i}>{r.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody>
                </table>
              )}
              {s.lines && <ul>{s.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>}
            </section>
          ))}
          <footer className="nr-doc__foot">{doc.footer.map((f, i) => <p key={i}>{f}</p>)}</footer>
        </article>
      </div>
    </div>
  );
}
