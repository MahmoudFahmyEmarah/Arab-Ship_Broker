"use client";

// The printable Negotiation Summary (lib/fixture-room/documents.ts).
import type { FixtureRoomView } from "@/lib/fixture-room/types";
import { summaryDocument } from "@/lib/fixture-room/documents";
import { FixtureDocumentView } from "./FixtureDocumentView";

export function SummaryPrint({ view }: { view: FixtureRoomView }) {
  const back = `/dashboard/fixture-room/${view.room.id}`;
  return <FixtureDocumentView doc={summaryDocument(view)} backHref={back} otherHref={`${back}/recap`} otherLabel="Fixture recap" />;
}
