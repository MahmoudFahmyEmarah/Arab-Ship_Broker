"use client";

// Ports registry as the compact adm-data-card grid. Search + pager from
// CardGrid; each card keeps the existing PortRowActions (verify/edit/delete).
import { CardGrid } from "@/components/admin/ui/CardGrid";
import { DataCard } from "@/components/admin/ui/DataCard";
import { AdminBadge } from "@/components/admin/AdminBadge";
import { PortRowActions } from "@/components/admin/ports/PortRowActions";
import type { AdminPortRow } from "@/lib/admin/types";

function StatusBadge({ port }: { port: AdminPortRow }) {
  if (!port.is_verified) return <AdminBadge variant="pending" label="Unverified" />;
  if (!port.is_active) return <AdminBadge variant="inactive" label="Inactive" />;
  return <AdminBadge variant="approved" label="Active" />;
}

export function PortsGrid({ ports }: { ports: AdminPortRow[] }) {
  return (
    <CardGrid
      rows={ports as unknown as Record<string, unknown>[]}
      searchKeys={["trade_name", "locode", "country", "zone"]}
      searchPlaceholder="Search port name, LOCODE or country…"
      emptyText="No ports found"
      renderCard={(row) => {
        const port = row as unknown as AdminPortRow;
        return (
          <DataCard
            key={port.locode}
            title={port.trade_name}
            sub={port.locode}
            inactive={!port.is_active}
            incomplete={!port.is_verified}
            incompleteLabel="Unverified"
            kvs={[
              { k: "Country", v: port.country },
              { k: "Zone", v: port.zone, blue: true },
              { k: "Type", v: port.port_type },
              { k: "Status", v: <StatusBadge port={port} /> },
            ]}
            footer={<PortRowActions port={port} />}
          />
        );
      }}
    />
  );
}
