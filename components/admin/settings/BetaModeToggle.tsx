"use client";

import * as React from "react";
import { setBetaMode } from "@/app/(admin)/admin/settings/actions";

// Owner-only toggle for the global beta-mode flag. Optimistic flip with revert
// on failure; the server action revalidates the dashboard layout so the change
// lands for every member on their next navigation.
export function BetaModeToggle({ initial }: { initial: boolean }) {
  const [on, setOn] = React.useState(initial);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);

  function toggle() {
    const next = !on;
    setError(null);
    setOn(next); // optimistic
    startTransition(async () => {
      const res = await setBetaMode(next);
      if (!res.success) {
        setOn(!next); // revert
        setError(res.error ?? "Failed to update");
      }
    });
  }

  return (
    <div
      className="adm-card"
      style={{ display: "flex", alignItems: "center", gap: 16, justifyContent: "space-between" }}
    >
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--adm-ink)" }}>
          Beta mode {on ? "enabled" : "disabled"}
        </div>
        <div style={{ fontSize: 11, color: "var(--adm-muted)", marginTop: 2, lineHeight: 1.6 }}>
          {on
            ? "Members are limited to the Dashboard. Every other page shows the “Coming soon” overlay."
            : "All pages are fully open to members per their normal access."}
        </div>
        {error && (
          <div style={{ fontSize: 11, color: "var(--asb-red)", marginTop: 6 }}>{error}</div>
        )}
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Toggle beta mode"
        disabled={pending}
        onClick={toggle}
        style={{
          flex: "none",
          width: 46,
          height: 26,
          borderRadius: 999,
          border: "none",
          cursor: pending ? "wait" : "pointer",
          position: "relative",
          background: on ? "var(--asb-navy)" : "var(--asb-gray-400)",
          transition: "background 160ms ease",
          opacity: pending ? 0.7 : 1,
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 3,
            left: on ? 23 : 3,
            width: 20,
            height: 20,
            borderRadius: "50%",
            background: "#fff",
            transition: "left 160ms ease",
            boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
          }}
        />
      </button>
    </div>
  );
}
