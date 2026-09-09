"use client";

// Contacts registry — the GDPR record behind every broker / sender the
// platform stores. Search, see where a contact is used, and erase on request
// (anonymises the record and scrubs every copy; audited in contact_erasures).
import * as React from "react";
import { toast } from "sonner";
import { eraseContact, listContacts, type ContactRow } from "@/app/(admin)/admin/org-members/actions";

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");

export function ContactsRegistry({ initial, canErase }: { initial: ContactRow[]; canErase: boolean }) {
  const [rows, setRows] = React.useState(initial);
  const [q, setQ] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [target, setTarget] = React.useState<ContactRow | null>(null);
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    const t = setTimeout(async () => { setLoading(true); const r = await listContacts(q); setLoading(false); if (r.ok) setRows(r.rows); }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const live = rows.filter((r) => !r.erased_at).length;
  const erase = async () => {
    if (!target) return;
    setBusy(true);
    const r = await eraseContact(target.id, reason.trim());
    setBusy(false);
    if (!r.ok) { toast.error(r.error ?? "Erasure failed"); return; }
    const a = r.affected ?? {};
    toast.success(`Erased. Scrubbed ${a.cargo_broker ?? 0} broker cells, ${a.cargo_source ?? 0} cargo senders, ${a.positions ?? 0} positions, ${a.review_queue ?? 0} queue rows, ${a.staged_rows ?? 0} staged rows, ${a.audit_images ?? 0} audit images.`);
    setTarget(null); setReason("");
    const l = await listContacts(q); if (l.ok) setRows(l.rows);
  };

  return (
    <div className="adm-card" style={{ marginTop: 16 }}>
      <div className="adm-card__head">
        <span className="adm-card__title">Contacts registry · GDPR</span>
        <span className="adm-card__sub">{live} live · {rows.length - live} erased · every broker or sender on a listing points here</span>
      </div>
      <div className="adm-filterbar" style={{ marginBottom: 10 }}>
        <input className="adm-search" placeholder="Search name, e-mail or company…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span style={{ fontSize: 11, color: "var(--adm-muted)" }}>Bound automatically on every write (workbook BROKER cell, circular and WhatsApp senders, Manual Review). Erasing anonymises the record and scrubs every copy, including staged rows and edit-audit images.</span>
      </div>
      <div className="adm-table"><div style={{ overflowX: "auto" }}><table style={{ minWidth: 900 }}>
        <thead><tr><th>Contact</th><th>Kind</th><th>Company</th><th>Role · source</th><th className="num">Cargo</th><th className="num">Positions</th><th className="num">Queue</th><th>First seen</th><th>Last seen</th><th /></tr></thead>
        <tbody>
          {rows.length === 0 && <tr className="no-hover"><td colSpan={10} style={{ textAlign: "center", padding: 24, color: "var(--adm-muted)" }}>{loading ? "Searching…" : "No contacts match."}</td></tr>}
          {rows.map((r) => (
            <tr key={r.id} className="no-hover" style={r.erased_at ? { opacity: .55 } : undefined}>
              <td><div style={{ fontWeight: 600, color: "var(--asb-navy)" }}>{r.display_name}</div><div style={{ fontSize: 11, color: "var(--adm-muted)" }}>{r.email ?? ""}{r.email && r.phone ? " · " : ""}{r.phone ?? ""}{r.erased_at ? `erased ${fmt(r.erased_at)}${r.erase_reason ? ` · ${r.erase_reason}` : ""}` : ""}</div></td>
              <td><span className={`adm-badge ${r.kind === "desk" ? "closed" : "tier"}`}>{r.kind}</span></td>
              <td>{r.org_name ?? "—"}</td>
              <td style={{ fontSize: 12 }}>{r.role ?? "—"} · {r.source}</td>
              <td className="num">{r.cargo_count}</td><td className="num">{r.position_count}</td><td className="num">{r.queue_count}</td>
              <td>{fmt(r.first_seen)}</td><td>{fmt(r.last_seen)}</td>
              <td style={{ textAlign: "right" }}>{!r.erased_at && <button type="button" className="adm-btn small" style={{ color: "var(--adm-red)" }} disabled={!canErase} title="Erase on request — anonymises the record and scrubs every copy" onClick={() => { setTarget(r); setReason(""); }}>Erase…</button>}</td>
            </tr>
          ))}
        </tbody>
      </table></div></div>
      {target && (
        <div style={{ position: "fixed", inset: 0, zIndex: 95, background: "var(--scrim)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onMouseDown={(e) => { if (e.target === e.currentTarget) setTarget(null); }}>
          <div className="adm-card" role="dialog" aria-modal="true" style={{ width: "min(460px,100%)", padding: "18px 20px" }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: "var(--asb-navy)" }}>Erase {target.display_name}?</div>
            <p style={{ fontSize: 13, color: "var(--asb-ink-secondary)", margin: "8px 0" }}>The record becomes &quot;Erased contact&quot; with no e-mail or phone. Broker cells on {target.cargo_count} cargo rows are replaced by the company name (or &quot;Erased contact&quot;), sender fields are cleared on listings, positions and the review queue, and the name and e-mail are scrubbed from staged rows and edit-audit images. This cannot be undone.</p>
            <textarea className="adm-textarea" rows={2} placeholder="Reason (e.g. data-subject request received 9 Sep 2026)" value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: "100%" }} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 12 }}>
              <button type="button" className="adm-btn" onClick={() => setTarget(null)} disabled={busy}>Cancel</button>
              <button type="button" className="adm-btn reject" disabled={busy || reason.trim().length < 4} onClick={erase}>{busy ? "Erasing…" : "Erase contact"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
