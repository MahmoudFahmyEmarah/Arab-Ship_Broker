"use client";

// Bunker price entry: the supplier, then a port searched from THAT supplier's registered ports (the server action
// only accepts a registered port). Replaces the hand-typed LOCODE (owner, 19 Oct 2026). Form names are unchanged:
// supplierId, portLocode.
import * as React from "react";
import { PortSearchField } from "@/components/ports/PortSearchField";
import type { PortChoice } from "@/lib/ports/port-search";

export interface SupplierPortOption {
  id: string;
  name: string;
  disabled: boolean;
  ports: { locode: string; name: string; isPrimary: boolean }[];
}

export function SupplierPortFields({ suppliers }: { suppliers: SupplierPortOption[] }) {
  const [supplierId, setSupplierId] = React.useState(suppliers[0]?.id ?? "");
  const [port, setPort] = React.useState<string | null>(null);
  const supplier = suppliers.find((s) => s.id === supplierId);
  const options: PortChoice[] = React.useMemo(
    () => (supplier?.ports ?? []).map((p) => ({ locode: p.locode, name: p.name, note: p.isPrimary ? "primary" : null })),
    [supplier],
  );
  const onPort = React.useCallback((p: PortChoice | null) => setPort(p?.locode ?? null), []);

  return (
    <>
      <label className="adm-field"><span className="adm-field__label">Supplier</span>
        <select className="adm-select" name="supplierId" required value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setPort(null); }}>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.disabled ? " (disabled)" : ""}</option>)}
        </select>
      </label>
      <label className="adm-field"><span className="adm-field__label">Port (registered for the supplier)</span>
        <PortSearchField
          name="portLocode"
          required
          options={options}
          value={port}
          onChange={onPort}
          inputClassName="adm-input"
          ariaLabel="Port registered for the supplier"
          emptyListNote="This supplier has no registered ports — add one under Suppliers first."
        />
      </label>
    </>
  );
}
