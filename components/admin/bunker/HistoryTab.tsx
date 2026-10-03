import type { AdminBunkerDashboard } from "@/lib/bunker/admin";

const ACTION_LABEL: Record<string, string> = {
  submit: "Submitted", approve: "Approved", reject: "Rejected",
  withdraw: "Withdrawn", override: "Admin override", import: "Imported",
};
const ACTION_BADGE: Record<string, string> = {
  submit: "pending", approve: "live", reject: "rejected", withdraw: "expired", override: "amber", import: "tier",
};

export function HistoryTab({ dash }: { dash: AdminBunkerDashboard }) {
  if (dash.events.length === 0) return <div className="adm-empty">No price activity yet.</div>;
  return (
    <section className="adm-card">
      <div className="adm-card__head">
        <span className="adm-card__title">Update history</span>
        <span className="adm-card__sub">Latest 200 events. Quotes are append-only: every change is a new row.</span>
      </div>
      <div className="adm-table">
        <table>
          <thead><tr><th>When (UTC)</th><th>Supplier</th><th>Action</th><th>Port</th><th>Product</th><th className="num">Old</th><th className="num">New</th><th>By</th><th>Reason</th></tr></thead>
          <tbody>
            {dash.events.map((e, i) => (
              <tr key={`${e.at}-${i}`} className="no-hover">
                <td className="mono">{e.at.slice(0, 16).replace("T", " ")}</td>
                <td>{e.supplierName}</td>
                <td><span className={`adm-badge ${ACTION_BADGE[e.action] ?? "draft"}`}>{ACTION_LABEL[e.action] ?? e.action}</span></td>
                <td className="mono">{e.portLocode}</td>
                <td>{e.productKey}</td>
                <td className="num">{e.oldPrice != null ? `$${e.oldPrice}` : "—"}</td>
                <td className="num">{e.newPrice != null ? `$${e.newPrice}` : "—"}</td>
                <td>{e.actorName ?? "—"}</td>
                <td>{e.reason ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
