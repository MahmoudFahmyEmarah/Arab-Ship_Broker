"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CheckCircle2,
  XCircle,
  Edit3,
  AlertTriangle,
  Loader2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  approveQueueItem,
  rejectQueueItem,
  amendQueueItem,
  flagQueueItem,
} from "@/app/(admin)/admin/queue/actions";

interface ReviewActionsProps {
  queueItemId: string;
  listingType: "cargo" | "vessel_availability";
  successRedirectPath?: string;
}

type ActiveForm = "reject" | "amend" | "flag" | null;

export function ReviewActions({
  queueItemId,
  successRedirectPath,
}: ReviewActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [activeForm, setActiveForm] = useState<ActiveForm>(null);
  const [reason, setReason] = useState("");
  const [amendDetail, setAmendDetail] = useState("");

  function onActionSuccess(message: string) {
    toast.success(message);
    router.push(successRedirectPath ?? "/admin/queue");
    router.refresh();
  }

  function toggleForm(form: ActiveForm) {
    setActiveForm((cur) => (cur === form ? null : form));
    setReason("");
    setAmendDetail("");
  }

  async function handleApprove() {
    startTransition(async () => {
      const result = await approveQueueItem(queueItemId);
      if (result.success) {
        onActionSuccess("Listing approved and now live.");
      } else {
        toast.error(result.error ?? "Approval failed.");
      }
    });
  }

  async function handleReject() {
    if (!reason.trim()) {
      toast.error("Please enter a rejection reason.");
      return;
    }
    startTransition(async () => {
      const result = await rejectQueueItem(queueItemId, reason);
      if (result.success) {
        onActionSuccess("Listing rejected. Submitter notified.");
      } else {
        toast.error(result.error ?? "Rejection failed.");
      }
    });
  }

  async function handleAmend() {
    if (!amendDetail.trim()) {
      toast.error("Please describe what was amended.");
      return;
    }
    startTransition(async () => {
      const result = await amendQueueItem(queueItemId, amendDetail);
      if (result.success) {
        onActionSuccess("Listing amended and approved. Strike recorded.");
      } else {
        toast.error(result.error ?? "Amendment failed.");
      }
    });
  }

  async function handleFlag() {
    if (!reason.trim()) {
      toast.error("Please enter a flag reason.");
      return;
    }
    startTransition(async () => {
      const result = await flagQueueItem(queueItemId, reason);
      if (result.success) {
        onActionSuccess("Listing flagged. Strike recorded.");
      } else {
        toast.error(result.error ?? "Flag action failed.");
      }
    });
  }

  return (
    <div className="dp-card overflow-hidden">
      <div className="px-6 py-4 border-b border-asb-gray-100">
        <h2 className="text-sm font-bold text-asb-navy">Review decision</h2>
        <p className="text-xs text-asb-gray-400 mt-0.5">
          Each action triggers cascading effects on the listing and the
          submitter&apos;s trust record.
        </p>
      </div>

      <div className="p-4 space-y-2">
        <button
          onClick={handleApprove}
          disabled={isPending}
          className="w-full flex items-center gap-3 px-4 py-3.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded font-semibold text-sm transition-colors"
        >
          {isPending ? (
            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          )}
          <span className="flex-1 text-left">Approve</span>
          <div className="text-right">
            <p className="text-[10px] font-normal text-green-200">
              Goes live · clean_posts+1
            </p>
          </div>
        </button>

        <div className="rounded border border-amber-200 overflow-hidden">
          <button
            onClick={() => toggleForm("amend")}
            disabled={isPending}
            className="w-full flex items-center gap-3 px-4 py-3.5 bg-amber-50 hover:bg-amber-100 disabled:opacity-50 text-amber-800 font-semibold text-sm transition-colors"
          >
            <Edit3 className="w-4 h-4 shrink-0 text-amber-600" />
            <span className="flex-1 text-left">Approve with amendments</span>
            <div className="text-right mr-1">
              <p className="text-[10px] font-normal text-amber-600">
                Goes live · strike+1
              </p>
            </div>
            {activeForm === "amend" ? (
              <ChevronUp className="w-4 h-4 shrink-0 text-amber-500" />
            ) : (
              <ChevronDown className="w-4 h-4 shrink-0 text-amber-500" />
            )}
          </button>

          {activeForm === "amend" && (
            <div className="px-4 pb-4 pt-3 bg-amber-50 border-t border-amber-100 space-y-3">
              <p className="text-xs text-amber-700 leading-relaxed">
                Edit the listing fields directly first, then describe the
                corrections here. The submitter will see this note.
              </p>
              <textarea
                value={amendDetail}
                onChange={(e) => setAmendDetail(e.target.value)}
                rows={3}
                placeholder="Describe what was corrected (e.g. 'Corrected load port zone from E.MED to B.SEA')…"
                className="w-full text-sm px-3 py-2.5 rounded border border-amber-200 bg-white resize-none focus:outline-none  focus:ring-amber-400 focus:border-amber-400 placeholder:text-asb-gray-400"
              />
              <button
                onClick={handleAmend}
                disabled={isPending || !amendDetail.trim()}
                className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-sm font-bold rounded transition-colors"
              >
                {isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                ) : (
                  "Confirm amendment & approve"
                )}
              </button>
            </div>
          )}
        </div>

        <div className="rounded border border-red-200 overflow-hidden">
          <button
            onClick={() => toggleForm("reject")}
            disabled={isPending}
            className="w-full flex items-center gap-3 px-4 py-3.5 bg-red-50 hover:bg-red-100 disabled:opacity-50 text-red-700 font-semibold text-sm transition-colors"
          >
            <XCircle className="w-4 h-4 shrink-0 text-red-500" />
            <span className="flex-1 text-left">Reject</span>
            <div className="text-right mr-1">
              <p className="text-[10px] font-normal text-red-400">
                Not live · strike+1
              </p>
            </div>
            {activeForm === "reject" ? (
              <ChevronUp className="w-4 h-4 shrink-0 text-red-400" />
            ) : (
              <ChevronDown className="w-4 h-4 shrink-0 text-red-400" />
            )}
          </button>

          {activeForm === "reject" && (
            <div className="px-4 pb-4 pt-3 bg-red-50 border-t border-red-100 space-y-3">
              <p className="text-xs text-red-600 leading-relaxed">
                The listing will not go live. The submitter&apos;s strike count
                increments by 1 (2 strikes → FLAGGED tier).
              </p>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="Reason for rejection (shown to submitter)…"
                className="w-full text-sm px-3 py-2.5 rounded border border-red-200 bg-white resize-none focus:outline-none  focus:ring-red-400 focus:border-red-400 placeholder:text-asb-gray-400"
              />
              <button
                onClick={handleReject}
                disabled={isPending || !reason.trim()}
                className="w-full py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-bold rounded transition-colors"
              >
                {isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                ) : (
                  "Confirm rejection"
                )}
              </button>
            </div>
          )}
        </div>

        <div className="rounded border border-orange-200 overflow-hidden">
          <button
            onClick={() => toggleForm("flag")}
            disabled={isPending}
            className="w-full flex items-center gap-3 px-4 py-3.5 bg-orange-50 hover:bg-orange-100 disabled:opacity-50 text-orange-700 font-semibold text-sm transition-colors"
          >
            <AlertTriangle className="w-4 h-4 shrink-0 text-orange-500" />
            <span className="flex-1 text-left">Flag for further review</span>
            <div className="text-right mr-1">
              <p className="text-[10px] font-normal text-orange-400">
                Held · strike+1
              </p>
            </div>
            {activeForm === "flag" ? (
              <ChevronUp className="w-4 h-4 shrink-0 text-orange-400" />
            ) : (
              <ChevronDown className="w-4 h-4 shrink-0 text-orange-400" />
            )}
          </button>

          {activeForm === "flag" && (
            <div className="px-4 pb-4 pt-3 bg-orange-50 border-t border-orange-100 space-y-3">
              <p className="text-xs text-orange-700 leading-relaxed">
                Use when the submission requires further investigation (e.g.
                suspect vessel, incomplete data, potential fraud).
              </p>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="Reason for flagging (internal admin note)…"
                className="w-full text-sm px-3 py-2.5 rounded border border-orange-200 bg-white resize-none focus:outline-none  focus:ring-orange-400 focus:border-orange-400 placeholder:text-asb-gray-400"
              />
              <button
                onClick={handleFlag}
                disabled={isPending || !reason.trim()}
                className="w-full py-2.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-bold rounded transition-colors"
              >
                {isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                ) : (
                  "Confirm flag"
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
