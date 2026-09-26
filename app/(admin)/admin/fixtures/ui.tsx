// Admin → Fixture rooms · small server-rendered pieces shared by the list and
// the room page. Design tokens and the console's `adm-*` vocabulary only.
import type { FixtureRoomStatus } from "@/lib/fixture-room/types";
import { ROOM_STATUS_LABEL } from "@/lib/fixture-room/state-machine";

const BADGE: Record<FixtureRoomStatus, string> = {
  draft: "draft",
  invited: "pending",
  negotiating: "live",
  on_subjects: "amber",
  fixed: "active",
  withdrawn: "inactive",
  failed: "rejected",
  expired: "expired",
};

export function StatusBadge({ status }: { status: FixtureRoomStatus }) {
  return <span className={`adm-badge ${BADGE[status] ?? "draft"}`}>{ROOM_STATUS_LABEL[status] ?? status}</span>;
}

/**
 * The console depends on the database's admin authority, fn_is_admin(): the
 * JWT claim app_metadata.role = 'admin' AND a current, active admin row
 * (integration commit 7fb2064, 26 Sep 2026; the claim is written when an
 * account is promoted). A session without the claim, or demoted after its
 * token was issued, is a member to the ledger (own rooms only, masked, no
 * redaction) — see mailbox O2C-004.
 */
export function ClaimNotice({ present }: { present: boolean }) {
  if (present) return null;
  return (
    <div className="adm-page__warn" role="status" data-testid="fixtures-claim-notice">
      <span aria-hidden>⚠</span>
      <span>
        This session carries no admin claim (<code>app_metadata.role</code>), so the ledger treats it as a member:
        only rooms you are a party to are listed, identities stay masked and admin actions are refused.
        The claim is written when an account is promoted; sign out and in again after a promotion.
      </span>
    </div>
  );
}

export function Card({ title, sub, children, testId }: { title: string; sub?: string; children: React.ReactNode; testId?: string }) {
  return (
    <section className="adm-card" style={{ marginTop: 12 }} data-testid={testId}>
      <div className="adm-card__head">
        <h2 className="adm-card__title">{title}</h2>
        {sub && <span className="adm-card__sub">{sub}</span>}
      </div>
      {children}
    </section>
  );
}

export function Mono({ value }: { value: string | number | null | undefined }) {
  return <code className="mono" style={{ fontSize: "var(--fs-label)" }}>{value == null || value === "" ? "—" : String(value)}</code>;
}
