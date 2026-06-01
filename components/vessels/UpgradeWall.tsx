import Link from "next/link";
import { Lock } from "lucide-react";

/**
 * "Upgrade to see the full record" teaser shown to non-subscriber (T1/T2)
 * viewers in place of the gated commercial card. This is a conversion funnel
 * back to Arab ShipBroker — it renders NO counterparty identity (only the
 * vessel's own public particulars as chips). Contact remains admin/owner-only;
 * upgrading does not bypass the firewall, it routes the introduction through
 * Arab ShipBroker.
 */
export function UpgradeWall({
  vesselName,
  vesselType,
  builtYear,
}: {
  vesselName: string;
  vesselType: string;
  builtYear: number | null;
}) {
  return (
    <div className="rounded border border-asb-gray-200 bg-asb-white p-6 text-center">
      <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full border border-asb-gray-200 bg-asb-gray-50">
        <Lock className="h-4.5 w-4.5 text-asb-gray-400" />
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-center gap-1.5">
        <span className="rounded-[3px] border border-asb-gray-200 bg-asb-gray-50 px-2 py-0.5 text-[10px] font-semibold text-asb-ink-soft">
          {vesselName}
        </span>
        <span className="rounded-[3px] border border-asb-gray-200 bg-asb-gray-50 px-2 py-0.5 text-[10px] font-semibold text-asb-ink-soft">
          {vesselType}
        </span>
        {builtYear && (
          <span className="rounded-[3px] border border-asb-gray-200 bg-asb-gray-50 px-2 py-0.5 text-[10px] font-semibold text-asb-ink-soft">
            Built {builtYear}
          </span>
        )}
      </div>

      <h3 className="text-[15px] font-semibold text-asb-navy">
        Upgrade to see the full record
      </h3>
      <p className="mx-auto mt-1.5 max-w-xs text-xs leading-relaxed text-asb-gray-500">
        Company roles and commercial particulars are available to Tier 3
        subscribers and Arab ShipBroker partners. Arab ShipBroker holds these
        details and brokers the introduction.
      </p>

      <div className="mt-4 flex items-center justify-center gap-3">
        <Link
          href="/dashboard/account"
          className="rounded bg-asb-navy px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-asb-navy-deep"
        >
          Upgrade to Tier 3
        </Link>
        <Link
          href="/dashboard/account"
          className="text-xs font-medium text-asb-blue hover:underline"
        >
          Become a partner
        </Link>
      </div>

      <p className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-asb-gray-400">
        <Lock className="h-3 w-3" /> Contact details are encrypted and brokered
        by Arab ShipBroker.
      </p>
    </div>
  );
}
