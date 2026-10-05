"use client";

// Economic calculators: the shared tier-lock screen. The calculators themselves
// are the governed pages: Voyage Estimator v2 (components/voyage), Suez Canal
// toll (components/suez) and the Ports Cost Estimator (components/pda). The
// legacy prototype calculators that computed from hard-coded fuel, KAP port
// and Suez figures and printed a global "Live" label were retired at
// composition (architect ruling on C2O-041, B2O-011 R3).
import Link from "next/link";
import "@/lib/portal/voyage-estimator.css";

export function CalculatorLocked({ title }: { title: string }) {
  return (
    <div className="ve-page">
      <div className="ve-shell">
        <div className="estimator-locked">
          <div className="locked-icon">🔒</div>
          <div className="locked-title">{title}</div>
          <div className="locked-features">Voyage cost estimate · Port disbursements<br />Suez Canal toll</div>
          <div className="locked-tier-note">Available from Subscriber tier (T3+)</div>
          <Link href="/dashboard/account?tab=billing" className="locked-upgrade-btn">Upgrade to Subscriber →</Link>
        </div>
      </div>
    </div>
  );
}
