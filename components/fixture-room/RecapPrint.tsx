"use client";

// The printable Fixture Recap: a published version rendered as the designed
// document (lib/fixture-room/documents.ts). Decision D7: in-app and print /
// "Save as PDF" in v1; the server PDF of the same model follows (O2C-009).
import Link from "next/link";
import type { FixtureRecapView, FixtureRoomView } from "@/lib/fixture-room/types";
import { recapDocument } from "@/lib/fixture-room/documents";
import { FixtureDocumentView } from "./FixtureDocumentView";

export function RecapPrint({ view, recap }: { view: FixtureRoomView; recap: FixtureRecapView | null }) {
  const back = `/dashboard/fixture-room/${view.room.id}`;
  if (!recap) {
    return (
      <div className="nr">
        <div className="nr-print__page">
          <div className="nr-print__acts">
            <Link href={back} className="asb-btn">← Back to the room</Link>
            <Link href={`${back}/summary`} className="asb-btn">Negotiation summary</Link>
          </div>
          <article className="nr-doc" data-testid="recap-print">
            <h1>No recap published yet</h1>
            <p className="nr-print__meta">Publish a recap from the room to get a versioned, printable record.</p>
          </article>
        </div>
      </div>
    );
  }
  return <FixtureDocumentView doc={recapDocument(view, recap)} backHref={back} otherHref={`${back}/summary`} otherLabel="Negotiation summary" />;
}
