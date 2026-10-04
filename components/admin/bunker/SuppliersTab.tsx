import { saveSupplier, setSupplierMember } from "@/app/(admin)/admin/bunker/actions";
import type { AdminBunkerDashboard, AdminBunkerSupplier } from "@/lib/bunker/admin";

// Seeded pilot rows (migration 20261003108000) carry sample contacts until replaced.
const isPlaceholder = (s: AdminBunkerSupplier) =>
  (s.notes ?? "").startsWith("PILOT PLACEHOLDER") || (s.contactEmail ?? "").endsWith("@example.invalid");

const ago = (iso: string | null) => {
  if (!iso) return "never";
  const d = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  return d <= 0 ? "today" : `${d} d ago`;
};

function SupplierForm({ s }: { s?: AdminBunkerSupplier }) {
  const ports = s?.ports.map((p) => `${p.locode}${p.isPrimary ? "*" : ""}`).join(", ") ?? "";
  return (
    <form action={saveSupplier} className="adm-settings-grid">
      {s && <input type="hidden" name="id" value={s.id} />}
      <label className="adm-field"><span className="adm-field__label">Name (shown on the ticker)</span>
        <input className="adm-input" name="name" required minLength={2} maxLength={120} defaultValue={s?.name} />
      </label>
      <label className="adm-field"><span className="adm-field__label">Website</span>
        <input className="adm-input" name="url" type="url" placeholder="https://" defaultValue={s?.url ?? ""} />
      </label>
      <label className="adm-field"><span className="adm-field__label">Country</span>
        <input className="adm-input" name="country" defaultValue={s?.country ?? ""} />
      </label>
      <label className="adm-field"><span className="adm-field__label">Ports (LOCODEs, * = primary)</span>
        <input className="adm-input" name="ports" placeholder="EGPSD*, EGSUZ" defaultValue={ports} />
      </label>
      <label className="adm-field"><span className="adm-field__label">Trust score 0–100</span>
        <input className="adm-input" name="trustScore" type="number" min={0} max={100} defaultValue={s?.trustScore ?? 50} />
      </label>
      <label className="adm-field"><span className="adm-field__label">Contact name (private)</span>
        <input className="adm-input" name="contactName" defaultValue={s?.contactName ?? ""} />
      </label>
      <label className="adm-field"><span className="adm-field__label">Contact email (private)</span>
        <input className="adm-input" name="contactEmail" type="email" defaultValue={s?.contactEmail ?? ""} />
      </label>
      <label className="adm-field"><span className="adm-field__label">Contact phone (private)</span>
        <input className="adm-input" name="contactPhone" defaultValue={s?.contactPhone ?? ""} />
      </label>
      <label className="adm-field"><span className="adm-field__label">Notes</span>
        <input className="adm-input" name="notes" defaultValue={s?.notes ?? ""} />
      </label>
      <label className="adm-field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <input type="checkbox" name="enabled" defaultChecked={s ? s.status === "enabled" : true} /> Enabled (on the ticker and in the index)
      </label>
      <label className="adm-field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <input type="checkbox" name="verified" defaultChecked={s?.verified ?? false} /> Verified physical supplier (quotes auto-approved)
      </label>
      <div><button className="adm-btn primary" type="submit">{s ? "Save supplier" : "Add supplier"}</button></div>
    </form>
  );
}

function MemberForm({ supplierId }: { supplierId: string }) {
  return (
    <form action={setSupplierMember} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      <input type="hidden" name="supplierId" value={supplierId} />
      <input className="adm-input" name="email" type="email" required placeholder="member@supplier.com" aria-label="Member email" />
      <select className="adm-select" name="role" defaultValue="editor" aria-label="Role">
        <option value="editor">Editor (publishes prices)</option>
        <option value="viewer">Viewer</option>
        <option value="remove">Remove access</option>
      </select>
      <button className="adm-btn" type="submit">Apply</button>
    </form>
  );
}

export function SuppliersTab({ dash, canEdit }: { dash: AdminBunkerDashboard; canEdit: boolean }) {
  const alerts = dash.alerts.filter((a) => a.kind !== "pending_approval");
  const placeholders = dash.suppliers.filter(isPlaceholder);
  return (
    <>
      {placeholders.length > 0 && (
        <section className="adm-card" style={{ borderLeft: "2px solid var(--adm-amber-bd)" }}>
          <div className="adm-card__head">
            <span className="adm-card__title">Pilot suppliers: replace the sample details</span>
            <span className="adm-card__sub">
              {placeholders.map((s) => s.name).join(" · ")} were registered with sample contacts and ports.
            </span>
          </div>
          <ol style={{ margin: 0, paddingLeft: 18, fontSize: "var(--fs-body-sm)", lineHeight: 1.7 }}>
            <li>Open the supplier below and replace the contact name, email, phone, website and ports (LOCODEs, <code>*</code> marks the primary port); clear the notes; save.</li>
            <li>Ask the supplier&apos;s contact to sign up on the platform, then link that account under <em>Member email → Editor</em>.</li>
            <li>Tick <em>Verified</em> only for a first-hand physical supplier: its prices then go live without approval.</li>
            <li>Send the contact the link <code>/dashboard/bunker-supplier</code>. Nothing appears on the ticker until they publish a price.</li>
          </ol>
        </section>
      )}
      {alerts.length > 0 && (
        <section className="adm-card" style={{ borderLeft: "2px solid var(--adm-amber-bd)" }}>
          <div className="adm-card__head"><span className="adm-card__title">Freshness alerts</span></div>
          <ul className="adm-list">
            {alerts.map((a) => (
              <li key={a.supplierId} className="adm-list__row">
                <span className={`adm-badge ${a.kind === "stale" ? "stale" : "rejected"}`}>
                  {a.kind === "stale" ? "Stale" : a.kind === "expired" ? "Expired" : "No live quote"}
                </span>
                <span className="adm-list__title">{a.supplierName}</span>
                <span className="adm-list__meta">last live quote {ago(a.latestQuoteAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {dash.suppliers.map((s) => (
        <details key={s.id} className="adm-card">
          <summary style={{ cursor: "pointer", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <strong>{s.name}</strong>
            <span className={`adm-badge ${s.status === "enabled" ? "active" : "inactive"}`}>{s.status === "enabled" ? "Enabled" : "Disabled"}</span>
            {s.isPlatform ? <span className="adm-badge tier">Platform</span> : s.verified ? <span className="adm-badge live">Verified</span> : <span className="adm-badge pending">Unverified</span>}
            {isPlaceholder(s) && <span className="adm-badge amber">Placeholder details</span>}
            <span className="adm-card__sub">
              {s.ports.map((p) => p.name).join(" · ") || "no ports"} · {s.members.length} member{s.members.length === 1 ? "" : "s"} · last quote {ago(s.latestQuoteAt)}
            </span>
          </summary>
          {!s.isPlatform && (
            <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
              <div className="adm-table">
                <table>
                  <thead><tr><th>Member</th><th>Email</th><th>Role</th><th>Since</th></tr></thead>
                  <tbody>
                    {s.members.length === 0 ? (
                      <tr className="no-hover"><td colSpan={4} className="adm-empty">No member account linked yet.</td></tr>
                    ) : s.members.map((m) => (
                      <tr key={m.userId} className="no-hover">
                        <td>{m.name ?? "—"}</td><td>{m.email}</td><td>{m.role}</td>
                        <td>{new Date(m.since).toLocaleDateString("en-GB")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {canEdit && <MemberForm supplierId={s.id} />}
              {canEdit ? <SupplierForm s={s} /> : (
                <div className="adm-kv">
                  <span className="adm-kv__k">Contact</span>
                  <span className="adm-kv__v">{[s.contactName, s.contactEmail, s.contactPhone].filter(Boolean).join(" · ") || "—"}</span>
                </div>
              )}
            </div>
          )}
        </details>
      ))}

      {canEdit && (
        <section className="adm-card">
          <div className="adm-card__head">
            <span className="adm-card__title">Add a supplier</span>
            <span className="adm-card__sub">First-hand physical suppliers only. Access is by invitation: link a member account after saving.</span>
          </div>
          <SupplierForm />
        </section>
      )}
    </>
  );
}
