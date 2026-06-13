"use client";

// Compact admin users table — the default density for the user register.
import * as React from "react";
import { DataTable, type Column } from "@/components/admin/ui/DataTable";
import { AdminBadge, TrustTierBadge } from "@/components/admin/AdminBadge";

export type AdminUserListRow = {
  id: string;
  full_name: string | null;
  name: string | null;
  email: string;
  role: string;
  trust_tier: string;
  is_active: boolean;
  clean_posts: number;
  strike_count: number;
  company: string | null;
  created_at: string;
};

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function UsersTable({ rows }: { rows: AdminUserListRow[] }) {
  const columns: Column<AdminUserListRow>[] = [
    {
      key: "full_name",
      label: "Name",
      render: (r) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <strong style={{ color: "#1B3A5C", fontWeight: 500 }}>{r.full_name || r.name || "—"}</strong>
            {!r.is_active && <AdminBadge variant="inactive" label="Suspended" />}
          </span>
          <span className="mono" style={{ textTransform: "none" }}>{r.email}</span>
        </div>
      ),
    },
    { key: "role", label: "Role", render: (r) => <span style={{ textTransform: "capitalize" }}>{r.role.replace("_", " ")}</span> },
    { key: "company", label: "Company", render: (r) => r.company || "—" },
    { key: "clean_posts", label: "Clean", cellClass: "num", render: (r) => String(r.clean_posts) },
    {
      key: "strike_count",
      label: "Strikes",
      cellClass: "num",
      render: (r) => (
        <span style={{ color: r.strike_count > 0 ? "#C84A4A" : undefined, fontWeight: r.strike_count > 0 ? 600 : 400 }}>
          {r.strike_count}
        </span>
      ),
    },
    { key: "trust_tier", label: "Tier", render: (r) => <TrustTierBadge tier={r.trust_tier} /> },
    { key: "created_at", label: "Joined", render: (r) => fmt(r.created_at) },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      searchKeys={["full_name", "name", "email", "company"]}
      searchPlaceholder="Search name, email or company…"
      rowHref={(r) => `/admin/users/${r.id}`}
      emptyText="No users found"
    />
  );
}
