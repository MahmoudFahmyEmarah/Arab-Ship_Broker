"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { setCargoStatus } from "@/app/(admin)/admin/cargo/actions";
import { ReviewActions } from "@/components/admin/queue/ReviewActions";

interface CargoStatusControlsProps {
  cargoId: string;
  currentStatus: string;
  currentReviewStatus: string;
  pendingQueueItemId: string | null;
}

const STATUSES = ["IN", "PARTIAL", "OUT", "CLOSED"] as const;

export function CargoStatusControls({
  cargoId,
  currentStatus,
  currentReviewStatus,
  pendingQueueItemId,
}: CargoStatusControlsProps) {
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
      <div className="bg-white border border-asb-gray-200 rounded overflow-hidden">
        <div className="px-5 py-3.5 border-b border-asb-gray-100">
          <h3 className="text-xs font-bold text-asb-gray-500 uppercase tracking-wider">
            Listing status
          </h3>
        </div>
        <div className="p-4 grid grid-cols-2 gap-2">
          {STATUSES.map((s) => {
            const active = currentStatus === s;
            const colors: Record<string, string> = {
              IN: active
                ? "bg-green-600 text-white border-green-600"
                : "border-asb-gray-200 text-asb-gray-700 hover:border-green-400",
              PARTIAL: active
                ? "bg-amber-500 text-white border-amber-500"
                : "border-asb-gray-200 text-asb-gray-700 hover:border-amber-400",
              OUT: active
                ? "bg-asb-gray-700 text-white border-asb-gray-400"
                : "border-asb-gray-200 text-asb-gray-700 hover:border-asb-gray-400",
              CLOSED: active
                ? "bg-red-600 text-white border-red-600"
                : "border-asb-gray-200 text-asb-gray-700 hover:border-red-400",
            };
            return (
              <button
                key={s}
                disabled={active || isPending}
                onClick={() =>
                  act(() => setCargoStatus(cargoId, s), `Status set to ${s}`)
                }
                className={cn(
                  "py-2.5 text-xs font-bold rounded border transition-all disabled:opacity-60",
                  colors[s],
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
      </div>

      {pendingQueueItemId ? (
        <ReviewActions
          queueItemId={pendingQueueItemId}
          listingType="cargo"
          successRedirectPath={`/admin/cargo/${cargoId}`}
        />
      ) : (
        <div className="bg-white border border-asb-gray-200 rounded overflow-hidden">
          <div className="px-5 py-3.5 border-b border-asb-gray-100">
            <h3 className="text-xs font-bold text-asb-gray-500 uppercase tracking-wider">
              Moderation
            </h3>
          </div>
          <div className="px-5 py-4 space-y-2">
            <p className="text-xs text-asb-gray-500 leading-relaxed">
              No pending review item for this listing.
            </p>
            <p className="text-[11px] text-asb-gray-400 leading-relaxed">
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
              href="/admin/queue?status=PENDING&type=cargo"
              className="inline-flex items-center gap-1 text-xs font-semibold text-asb-blue hover:text-asb-blue"
            >
              Open cargo review queue
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
