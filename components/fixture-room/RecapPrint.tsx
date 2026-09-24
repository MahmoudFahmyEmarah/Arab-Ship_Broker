"use client";

import Link from "next/link";
import type { FixtureRecapView, FixtureRoomView } from "@/lib/fixture-room/types";
import { recapSections } from "@/lib/fixture-room/recap";
import { shortDateTime } from "@/lib/fixture-room/format";

export function RecapPrint({ view, recap }: { view: FixtureRoomView; recap: FixtureRecapView | null }) {
  const download = () => {
    if (!recap) return;
    const blob = new Blob([recap.contentText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Fixture-${view.room.ref}-recap-v${recap.versionNo}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="fxr">
      <div className="fxr-page">
        <div className="fxr-print__acts">
          <Link href={`/dashboard/fixture-room/${view.room.id}`} className="asb-btn">← Back to the room</Link>
          {recap && <button type="button" className="asb-btn" onClick={download}>Download .txt</button>}
          {recap && <button type="button" className="asb-btn primary" onClick={() => window.print()}>Print</button>}
        </div>
        <article className="fxr-print" data-testid="recap-print">
          {!recap ? (
            <>
              <h1>No recap published yet</h1>
              <p className="fxr-print__meta">Publish a recap from the room to get a versioned, printable record.</p>
            </>
          ) : (
            <>
              {recapSections(recap.content).map((s, i) => (
                <section key={s.title}>
                  {i === 0 ? <h1>{s.title}</h1> : <h2>{s.title}</h2>}
                  {i === 0 ? (
                    <p className="fxr-print__meta">
                      Version {recap.versionNo} · published {shortDateTime(recap.publishedAt)} by {recap.publishedByLabel ?? "—"}
                      {recap.invalidatedAt ? ` · superseded ${shortDateTime(recap.invalidatedAt)}` : ""}
                      {" · "}
                      {recap.acknowledgedByAllPrincipals ? "acknowledged by both principals" : `${recap.acknowledgements.length} acknowledgement${recap.acknowledgements.length === 1 ? "" : "s"}`}
                    </p>
                  ) : null}
                  <ul>
                    {s.lines.map((l, j) => <li key={j}>{l}</li>)}
                  </ul>
                </section>
              ))}
              {recap.acknowledgements.length > 0 && (
                <section>
                  <h2>Acknowledgements</h2>
                  <ul>
                    {recap.acknowledgements.map((a) => (
                      <li key={`${a.partyId}-${a.at}`}>{a.label} · {shortDateTime(a.at)}{a.relayed ? " · recorded by Arab ShipBroker on their behalf" : ""}</li>
                    ))}
                  </ul>
                </section>
              )}
              <p className="fxr-print__meta">Content hash {recap.contentHash}</p>
            </>
          )}
        </article>
      </div>
    </div>
  );
}
