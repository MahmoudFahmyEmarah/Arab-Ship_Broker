"use client";

// The design's sponsor list (Portal standalone 7 · PageBunker): a searchable grid of sponsor cards with the
// freshness badge, last update, status, "Manage access" and the ticker on/off toggle. The toggle re-saves the
// supplier exactly as stored with only its status flipped (the same saveSupplier action as the full form).
import * as React from "react";
import { CardGrid } from "@/components/admin/ui/CardGrid";
import { DataCard } from "@/components/admin/ui/DataCard";
import { saveSupplier } from "@/app/(admin)/admin/bunker/actions";
import type { AdminBunkerAlert, AdminBunkerSupplier } from "@/lib/bunker/admin";

const ago = (iso: string | null) => {
  if (!iso) return "never";
  const d = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  return d <= 0 ? "today" : `${d} d ago`;
};

type Fresh = { cls: string; label: string };
function freshnessOf(s: AdminBunkerSupplier, alerts: AdminBunkerAlert[]): Fresh {
  const a = alerts.find((x) => x.kind !== "pending_approval" && x.supplierId === s.id);
  if (!a || a.kind === "pending_approval") return s.latestQuoteAt ? { cls: "current", label: "CURRENT" } : { cls: "inactive", label: "NO QUOTE" };
  if (a.kind === "stale") return { cls: "stale", label: "STALE" };
  if (a.kind === "expired") return { cls: "expired", label: "EXPIRED" };
  return { cls: "inactive", label: "NO QUOTE" };
}

function ToggleForm({ s }: { s: AdminBunkerSupplier }) {
  const on = s.status === "enabled";
  return (
    <form action={saveSupplier}>
      <input type="hidden" name="id" value={s.id} />
      <input type="hidden" name="name" value={s.name} />
      <input type="hidden" name="url" value={s.url ?? ""} />
      <input type="hidden" name="country" value={s.country ?? ""} />
      {s.verified && <input type="hidden" name="verified" value="on" />}
      {!on && <input type="hidden" name="enabled" value="on" />}
      <input type="hidden" name="trustScore" value={String(s.trustScore)} />
      <input type="hidden" name="notes" value={s.notes ?? ""} />
      <input type="hidden" name="contactName" value={s.contactName ?? ""} />
      <input type="hidden" name="contactEmail" value={s.contactEmail ?? ""} />
      <input type="hidden" name="contactPhone" value={s.contactPhone ?? ""} />
      <input type="hidden" name="ports" value={s.ports.map((p) => `${p.locode}${p.isPrimary ? "*" : ""}`).join(", ")} />
      <button type="submit" className={`adm-toggle${on ? " is-on" : ""}`} role="switch" aria-checked={on} aria-label={`${s.name} on the ticker`} title={on ? "Disable on ticker" : "Enable on ticker"} />
    </form>
  );
}

export function SponsorGrid({ sponsors, alerts, canEdit }: { sponsors: AdminBunkerSupplier[]; alerts: AdminBunkerAlert[]; canEdit: boolean }) {
  const rows = sponsors.map((s) => ({ ...s, portsText: s.ports.map((p) => p.name).join(" / ") })) as (AdminBunkerSupplier & { portsText: string })[];
  return (
    <CardGrid
      rows={rows as unknown as Record<string, unknown>[]}
      searchKeys={["name", "portsText", "country"]}
      emptyText="No sponsor registered yet."
      renderCard={(row) => {
        const s = row as unknown as AdminBunkerSupplier & { portsText: string };
        const f = freshnessOf(s, alerts);
        return (
          <DataCard
            key={s.id}
            title={s.name}
            sub={s.portsText || "no ports"}
            badge={<span className={`adm-badge ${f.cls}`}>{f.label}</span>}
            inactive={s.status !== "enabled"}
            kvs={[
              { k: "Last updated", v: ago(s.latestQuoteAt) },
              { k: "Status", v: <span className={`adm-badge ${s.status === "enabled" ? "active" : "inactive"}`}>{s.status === "enabled" ? "ENABLED" : "DISABLED"}</span> },
            ]}
            footer={
              <>
                <a className="adm-data-card__edit" href={`#sponsor-${s.id}`} onClick={() => { const d = document.getElementById(`sponsor-${s.id}`); if (d instanceof HTMLDetailsElement) d.open = true; }}>Manage access</a>
                {canEdit && <ToggleForm s={s} />}
              </>
            }
          />
        );
      }}
    />
  );
}
