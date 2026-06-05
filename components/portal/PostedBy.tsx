import { orgForCargo, ORG_TYPE_LABEL } from "@/lib/portal/org";

// "Posted by" card — the cargo listing circulates under the company DESK;
// counterparties see the company + "handled by {name}", never the person's
// direct line. If the handler leaves, the listing stays with the firm.
// `internal` = the viewer is on the owning desk or ASB admin (sees handler +
// desk contact); outsiders see company identity only.
export function PostedBy({
  cargoKey,
  internal = false,
}: {
  cargoKey: string;
  internal?: boolean;
}) {
  const { org, handler } = orgForCargo(cargoKey);
  const Row = ({ k, v }: { k: string; v: string }) => (
    <div className="flex justify-between gap-4 py-1.5 border-b border-asb-gray-100 last:border-0">
      <span className="text-xs text-asb-gray-400 font-semibold uppercase tracking-wider">{k}</span>
      <span className="text-sm text-asb-navy text-right">{v}</span>
    </div>
  );
  return (
    <div className="bg-white border border-asb-gray-200 rounded p-4">
      <p className="text-xs font-bold text-asb-gray-400 uppercase tracking-wider mb-2">Posted by</p>
      <Row k="Company" v={org.name} />
      <Row k="Type" v={ORG_TYPE_LABEL[org.type]} />
      <Row k="Country" v={org.country} />
      <Row k="Subscription" v={org.tier} />
      <Row k="Handled by" v={internal ? handler.name : "—"} />
      <Row k="Desk" v={org.desk.name} />
      {internal ? (
        <>
          <Row k="Desk email" v={org.desk.email} />
          <Row k="Desk phone" v={org.desk.phone} />
        </>
      ) : (
        <p className="text-xs text-asb-gray-400 mt-2">
          Enquiries route to the company desk — handled by {handler.name}. No
          individual direct line is shown to counterparties.
        </p>
      )}
    </div>
  );
}
