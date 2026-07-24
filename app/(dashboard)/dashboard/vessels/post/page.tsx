import { ProfileGuard } from "@/components/ProfileGuard";
import { PostingAsChip } from "@/components/portal/PostingAsChip";
import { VesselLedger } from "@/components/ledger/vessel/VesselLedger";
import "@/components/ledger/ledger.css";

// Broker Ledger — Post Position (Concept 4). One unified flow: find or add the
// vessel (or TBN) and post her open position in a single submit. Replaces both
// /dashboard/vessels/register and /dashboard/vessels/[id]/availability/new;
// the legacy pages stay reachable until sign-off.
export default function PostVesselLedgerPage() {
  return (
    <ProfileGuard requires="vessel">
      <div className="asb-ds" style={{ minHeight: "100%", background: "var(--asb-gray-50)" }}>
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "10px 24px 0" }}>
          <PostingAsChip />
        </div>
        <VesselLedger />
      </div>
    </ProfileGuard>
  );
}
