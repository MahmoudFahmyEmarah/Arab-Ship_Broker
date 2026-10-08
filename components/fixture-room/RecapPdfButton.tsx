"use client";

// O2ALL-005: download the STORED recap PDF — the exact file generated when this version was published — through a
// 60-second link, and show its SHA-256 so either party can check the copy they hold.
import * as React from "react";
import { getFixtureRecapPdfAction } from "@/app/(dashboard)/dashboard/fixture-room/actions";

export function RecapPdfButton({ roomId, versionNo }: { roomId: string; versionNo: number }) {
  const [busy, setBusy] = React.useState(false);
  const [sha, setSha] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const download = async () => {
    setBusy(true); setError(null);
    try {
      const r = await getFixtureRecapPdfAction({ roomId, versionNo });
      if (!r.ok) { setError(r.message); return; }
      setSha(r.sha256);
      window.location.assign(r.url);
    } catch {
      setError("The recap PDF is not available right now. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button type="button" className="asb-btn primary" disabled={busy} onClick={() => void download()} data-testid="recap-pdf-download"
        title="The PDF stored when this recap version was published">{busy ? "Preparing…" : "Download PDF"}</button>
      {sha && <span className="nr-print__sha" data-testid="recap-pdf-sha" title={`SHA-256 ${sha}`}>SHA-256 {sha.slice(0, 12)}…</span>}
      {error && <span className="nr-print__err" role="alert" data-testid="recap-pdf-error">{error}</span>}
    </>
  );
}
