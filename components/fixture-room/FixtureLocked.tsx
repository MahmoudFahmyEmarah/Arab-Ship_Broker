import Link from "next/link";
import { IcLock } from "./icons";

// The tier gate as the design draws it (estimator-locked): T1 / T2 members
// with no fixture to take part in see the upsell; T3 / T4, market partners and
// admins get the room (decision D3 through canUseFixtureRoom). Invited parties
// are never locked out, whatever their plan.
export function FixtureLocked() {
  return (
    <div className="nr">
      <div className="estimator-locked" data-testid="fixture-locked">
        <span className="locked-icon" aria-hidden="true"><IcLock size={28} /></span>
        <div className="locked-title">Fixture Room</div>
        <div className="locked-features">
          Live cargo ⇄ vessel matching · bid / offer negotiation<br />
          Fixture recap, subjects and clean-fixture workflow
        </div>
        <div className="locked-tier-note">Available from Subscriber tier (T3+). If a counterparty invites you to a fixture, it will appear here regardless of your plan.</div>
        <Link href="/dashboard/account?tab=billing" className="locked-upgrade-btn">Upgrade to Subscriber →</Link>
      </div>
    </div>
  );
}
