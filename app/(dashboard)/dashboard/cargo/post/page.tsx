import { ProfileGuard } from "@/components/ProfileGuard";
import { PostingAsChip } from "@/components/portal/PostingAsChip";
import { CargoLedger } from "@/components/ledger/cargo/CargoLedger";
import "@/components/ledger/ledger.css";

// Broker Ledger — Post Cargo (Concept 4). Replaces /dashboard/cargo/create;
// the legacy page stays reachable until sign-off.
export default function PostCargoLedgerPage() {
  return (
    <ProfileGuard requires="cargo">
      <div className="asb-ds" style={{ minHeight: "100%", background: "var(--asb-gray-50)" }}>
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "10px 24px 0" }}>
          <PostingAsChip />
        </div>
        <CargoLedger />
      </div>
    </ProfileGuard>
  );
}
