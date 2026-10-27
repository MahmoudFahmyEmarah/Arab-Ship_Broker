import type { AdminBunkerDashboard } from "@/lib/bunker/admin";

const ACTION_LABEL: Record<string, string> = {
  submit: "Submitted", approve: "Approved", reject: "Rejected",
  withdraw: "Withdrawn", override: "Admin override", import: "Imported",
};
const ACTION_ICON: Record<string, string> = {
  submit: "is-amber", approve: "is-cargo", reject: "is-red", withdraw: "is-red", override: "is-amber", import: "is-vessel",
};
const when = (iso: string) => iso.slice(0, 16).replace("T", " ") + " UTC";

/** The design's update history (Portal standalone 7 · PageBunker): most recent first, one line per price event,
 *  with the old → new price, the actor and the audit reason. Quotes are append-only: every change is a new row. */
export function HistoryTab({ dash }: { dash: AdminBunkerDashboard }) {
  return (
    <section className="adm-card">
      <div className="adm-card__head">
        <span className="adm-card__title">Update history</span>
        <span className="adm-card__sub">Most recent first · latest 200 events</span>
      </div>
      {dash.events.length === 0 ? <div className="adm-empty">No price activity yet.</div> : (
        <div className="adm-list">
          {dash.events.map((e, i) => (
            <div key={`${e.at}-${i}`} className="adm-list__row">
              <span className={`adm-list__icon ${ACTION_ICON[e.action] ?? ""}`} aria-hidden="true">$</span>
              <div className="adm-list__body">
                <div className="adm-list__title">{e.supplierName}</div>
                <div className="adm-list__meta">
                  {ACTION_LABEL[e.action] ?? e.action} · {e.productKey} at {e.portLocode}
                  {e.oldPrice != null || e.newPrice != null ? ` · ${e.oldPrice != null ? `$${e.oldPrice}` : "—"} → ${e.newPrice != null ? `$${e.newPrice}` : "—"}` : ""}
                  {e.actorName ? ` · by ${e.actorName}` : ""}{e.reason ? ` · ${e.reason}` : ""}
                </div>
              </div>
              <span className="adm-list__when">{when(e.at)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
