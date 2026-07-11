"use client";

// Module-scoped error boundary. Any unforeseen render/runtime error inside the
// Data Sync module lands here — contained to the module (the admin shell stays)
// and recoverable via "Try again". The data itself is untouched (nothing is
// written to live tables without an explicit, server-validated commit).

import { useEffect } from "react";

export default function DataSyncError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("[data-sync]", error); }, [error]);

  return (
    <div className="adm-page">
      <div
        role="alert"
        style={{
          maxWidth: 640, margin: "40px auto", background: "#fff", border: "1px solid #f0d6d6",
          borderRadius: 12, padding: "28px 30px", boxShadow: "0 2px 12px rgba(10,26,47,.05)",
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#b23b3b" }}>
          Data Sync — unexpected error
        </div>
        <h2 style={{ margin: "8px 0 6px", fontSize: 22, fontWeight: 700, color: "#0a1a2f" }}>
          Something went wrong in this view
        </h2>
        <p style={{ fontSize: 14, color: "#55606d", lineHeight: 1.55, margin: 0 }}>
          The module hit a temporary issue while rendering. Your data is safe — nothing is written to
          the live tables without an explicit commit. Try again, or reload the page.
          {error?.digest ? <> <span style={{ color: "#8a929c" }}>(ref {error.digest})</span></> : null}
        </p>
        <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
          <button
            type="button"
            onClick={reset}
            style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 16px", borderRadius: 8, border: "none", cursor: "pointer", font: "inherit", fontSize: 13.5, fontWeight: 600, background: "#c69749", color: "#fff" }}
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => { if (typeof window !== "undefined") window.location.reload(); }}
            style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 16px", borderRadius: 8, border: "1px solid #e6e8ec", cursor: "pointer", font: "inherit", fontSize: 13.5, fontWeight: 600, background: "#fff", color: "#55606d" }}
          >
            Reload page
          </button>
        </div>
      </div>
    </div>
  );
}
