import Link from "next/link";

// The locked state for T1 / T2 members with no fixture to take part in
// (decision D3: creation is a Subscriber feature; invited parties are never
// locked out). Mirrors the calculators' locked card.
export function FixtureLocked() {
  return (
    <div className="fxr">
      <div className="fxr-page">
        <div className="fxr-locked" data-testid="fixture-locked">
          <div className="fxr-locked__icon" aria-hidden="true">🔒</div>
          <div className="fxr-locked__title">Fixture Room</div>
          <div className="fxr-locked__features">
            Live cargo ⇄ vessel matching · bid / offer negotiation
            <br />
            Fixture recap, subjects and clean-fixture workflow
          </div>
          <div className="fxr-locked__note">Available from Subscriber tier (T3+). If a counterparty invites you to a fixture, it will appear here regardless of your plan.</div>
          <Link href="/dashboard/account?tab=billing" className="asb-btn primary">Upgrade to Subscriber →</Link>
        </div>
      </div>
    </div>
  );
}
