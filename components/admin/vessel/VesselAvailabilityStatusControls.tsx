"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { setAvailabilityStatus } from "@/app/(admin)/admin/vessel-availability/actions";
import { ReviewActions } from "@/components/admin/queue/ReviewActions";

interface VesselAvailabilityStatusControlsProps {
  availabilityId: string;
  currentStatus: string;
  currentReviewStatus: string;
  pendingQueueItemId: string | null;
}

const STATUSES = ["OPEN", "ON SUBS", "FIXED", "INACTIVE"] as const;

type StatusType = (typeof STATUSES)[number];

const STATUS_COLORS: Record<StatusType, { active: string; inactive: string }> =
  {
    OPEN: {
      active: "bg-green-600 text-white border-green-600",
      inactive: "border-slate-200 text-slate-600 hover:border-green-400",
    },
    "ON SUBS": {
      active: "bg-amber-500 text-white border-amber-500",
      inactive: "border-slate-200 text-slate-600 hover:border-amber-400",
    },
    FIXED: {
      active: "bg-slate-600 text-white border-slate-600",
      inactive: "border-slate-200 text-slate-600 hover:border-slate-400",
    },
    INACTIVE: {
      active: "bg-red-600 text-white border-red-600",
      inactive: "border-slate-200 text-slate-600 hover:border-red-400",
    },
  };

export function VesselAvailabilityStatusControls({
  availabilityId,
  currentStatus,
  currentReviewStatus,
  pendingQueueItemId,
}: VesselAvailabilityStatusControlsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function act(
    fn: () => Promise<{ success: boolean; error?: string }>,
    msg: string,
  ) {
    startTransition(async () => {
      const r = await fn();
      if (r.success) {
        toast.success(msg);
        router.refresh();
      } else toast.error(r.error ?? "Action failed.");
    });
  }

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
            Operational status
          </h3>
        </div>
        <div className="p-4 grid grid-cols-2 gap-2">
          {STATUSES.map((s) => {
            const active = currentStatus === s;
            const colors = STATUS_COLORS[s];
            return (
              <button
                key={s}
                disabled={active || isPending}
                onClick={() =>
                  act(
                    () => setAvailabilityStatus(availabilityId, s),
                    `Status set to ${s}`,
                  )
                }
                className={cn(
                  "py-2.5 text-xs font-bold rounded-xl border transition-all disabled:opacity-60",
                  active ? colors.active : colors.inactive,
                )}
              >
                {s}
                {active && (
                  <span className="ml-1 opacity-70 font-normal text-[9px]">
                    current
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="px-5 pb-4">
          <p className="text-[10px] text-slate-400">
            FIXED and INACTIVE remove the vessel from match results immediately.
          </p>
        </div>
      </div>

      {pendingQueueItemId ? (
        <ReviewActions
          queueItemId={pendingQueueItemId}
          listingType="vessel_availability"
          successRedirectPath={`/admin/vessel-availability/${availabilityId}`}
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-100">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Moderation
            </h3>
          </div>
          <div className="px-5 py-4 space-y-2">
            <p className="text-xs text-slate-500 leading-relaxed">
              No pending review item for this posting.
            </p>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              User trust counters change only when a pending review-queue item
              is approved, amended, rejected, or flagged.
            </p>
            {currentReviewStatus === "PENDING" && (
              <p className="text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
                Review status is pending but no pending queue item is linked.
                Open the queue to reconcile this record.
              </p>
            )}
            <Link
              href="/admin/queue?status=PENDING&type=vessel_availability"
              className="inline-flex items-center gap-1 text-xs font-semibold text-ocean-600 hover:text-ocean-700"
            >
              Open vessel review queue
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
