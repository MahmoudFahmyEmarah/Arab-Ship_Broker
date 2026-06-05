"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ShieldAlert,
  ShieldCheck,
  Loader2,
  ClipboardCheck,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  setVesselRisk,
  setVesselScope,
  setVesselSanctioned,
  setVesselReviewStatus,
  updateVesselNotes,
} from "@/app/(admin)/admin/vessels/actions";
import type { AdminVesselRow, RiskLevel, VesselScope } from "@/lib/admin/types";

interface VesselIntelControlsProps {
  vessel: AdminVesselRow;
}

const RISK_LEVELS: { value: RiskLevel; cls: string; activeCls: string }[] = [
  {
    value: "CLEAR",
    cls: "border-asb-gray-200 text-asb-gray-700 hover:border-green-400",
    activeCls: "bg-green-600 text-white border-green-600",
  },
  {
    value: "LOW",
    cls: "border-asb-gray-200 text-asb-gray-700 hover:border-blue-400",
    activeCls: "bg-blue-600 text-white border-blue-600",
  },
  {
    value: "MEDIUM",
    cls: "border-asb-gray-200 text-asb-gray-700 hover:border-amber-400",
    activeCls: "bg-amber-500 text-white border-amber-500",
  },
  {
    value: "HIGH",
    cls: "border-asb-gray-200 text-asb-gray-700 hover:border-red-400",
    activeCls: "bg-red-600 text-white border-red-600",
  },
];

const SCOPE_VALUES: { value: VesselScope; cls: string; activeCls: string }[] = [
  {
    value: "In Scope",
    cls: "border-asb-gray-200 text-asb-gray-700 hover:border-green-400",
    activeCls: "bg-green-600 text-white border-green-600",
  },
  {
    value: "Marginal",
    cls: "border-asb-gray-200 text-asb-gray-700 hover:border-amber-400",
    activeCls: "bg-amber-500 text-white border-amber-500",
  },
  {
    value: "Out of Scope",
    cls: "border-asb-gray-200 text-asb-gray-700 hover:border-asb-gray-400",
    activeCls: "bg-asb-navy text-white border-asb-gray-700",
  },
];

export function VesselIntelControls({ vessel }: VesselIntelControlsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [riskNotes, setRiskNotes] = useState(vessel.risk_notes ?? "");
  const [notes, setNotes] = useState(vessel.notes ?? "");
  const [notesDirty, setNotesDirty] = useState(false);
  const [riskNotesDirty, setRiskNotesDirty] = useState(false);

  const isInReview = vessel.vessel_review_status === "IN_REVIEW";
  const [reviewReason, setReviewReason] = useState(
    vessel.vessel_review_reason ?? "",
  );

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

  function handleSetInReview() {
    if (!reviewReason.trim()) {
      toast.error(
        "Please enter a review reason before placing vessel In Review.",
      );
      return;
    }
    act(
      () => setVesselReviewStatus(vessel.id, "IN_REVIEW", reviewReason),
      "Vessel placed In Review — owner has been notified on their dashboard.",
    );
  }

  function handleClearReview() {
    act(
      () => setVesselReviewStatus(vessel.id, "CLEAR", ""),
      "Vessel review cleared — vessel returned to normal status.",
    );
  }

  return (
    <div className="space-y-4">
      <ControlCard title="Vessel Review">
        <div
          className={cn(
            "rounded p-4 border mb-3",
            isInReview
              ? "bg-orange-50 border-orange-200"
              : "bg-asb-gray-50 border-asb-gray-200",
          )}
        >
          <div className="flex items-center gap-2 mb-1">
            {isInReview ? (
              <ClipboardCheck className="w-4 h-4 text-orange-600" />
            ) : (
              <ClipboardCheck className="w-4 h-4 text-asb-gray-400" />
            )}
            <p
              className={cn(
                "text-sm font-bold",
                isInReview ? "text-orange-800" : "text-asb-gray-700",
              )}
            >
              {isInReview ? "IN REVIEW" : "No active review"}
            </p>
          </div>
          <p
            className={cn(
              "text-xs",
              isInReview ? "text-orange-600" : "text-asb-gray-400",
            )}
          >
            {isInReview
              ? "The vessel owner can see this status and reason on their dashboard."
              : "Vessel record is clear of any admin review flag."}
          </p>
          {isInReview && vessel.vessel_review_reason && (
            <p className="text-xs text-orange-700 mt-2 font-semibold border-t border-orange-200 pt-2">
              Current reason: &ldquo;{vessel.vessel_review_reason}&rdquo;
            </p>
          )}
        </div>

        <p className="text-xs text-asb-gray-500 mb-1.5">
          Reason shown to vessel owner (required to activate)
        </p>
        <textarea
          value={reviewReason}
          onChange={(e) => setReviewReason(e.target.value)}
          rows={3}
          placeholder="e.g. Vessel documentation requires verification before new positions can be posted…"
          className="w-full text-sm px-3 py-2 rounded border border-asb-gray-200 resize-none focus:outline-none  focus:border-asb-blue placeholder:text-asb-gray-400"
        />

        <div className="flex gap-2 mt-2">
          {!isInReview ? (
            <button
              disabled={isPending || !reviewReason.trim()}
              onClick={handleSetInReview}
              className="flex-1 py-2.5 text-xs font-bold text-orange-700 bg-orange-50 hover:bg-orange-100 border border-orange-200 rounded transition-colors disabled:opacity-50"
            >
              {isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mx-auto" />
              ) : (
                "Place Vessel In Review"
              )}
            </button>
          ) : (
            <>
              <button
                disabled={isPending}
                onClick={handleSetInReview}
                className="flex-1 py-2.5 text-xs font-bold text-orange-700 bg-orange-50 hover:bg-orange-100 border border-orange-200 rounded transition-colors disabled:opacity-50"
              >
                {isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                ) : (
                  "Update reason"
                )}
              </button>
              <button
                disabled={isPending}
                onClick={handleClearReview}
                className="flex-1 py-2.5 text-xs font-bold text-green-700 bg-green-50 hover:bg-green-100 border border-green-200 rounded transition-colors disabled:opacity-50 flex items-center justify-center gap-1"
              >
                {isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <X className="w-3.5 h-3.5" /> Clear review
                  </>
                )}
              </button>
            </>
          )}
        </div>
        <p className="text-[10px] text-asb-gray-400 mt-2">
          This flags the vessel record itself — independent of individual
          availability posting reviews.
        </p>
      </ControlCard>

      <ControlCard title="Sanctions status">
        <div
          className={cn(
            "rounded p-4 border mb-3",
            vessel.is_sanctioned
              ? "bg-red-50 border-red-200"
              : "bg-green-50 border-green-200",
          )}
        >
          <div className="flex items-center gap-2 mb-1">
            {vessel.is_sanctioned ? (
              <ShieldAlert className="w-4 h-4 text-red-600" />
            ) : (
              <ShieldCheck className="w-4 h-4 text-green-600" />
            )}
            <p
              className={cn(
                "text-sm font-bold",
                vessel.is_sanctioned ? "text-red-800" : "text-green-800",
              )}
            >
              {vessel.is_sanctioned ? "SANCTIONED" : "Not sanctioned"}
            </p>
          </div>
          <p
            className={cn(
              "text-xs",
              vessel.is_sanctioned ? "text-red-600" : "text-green-600",
            )}
          >
            {vessel.is_sanctioned
              ? "This vessel is blocked from all match results. No availability can be posted."
              : "Vessel appears in match results normally."}
          </p>
        </div>
        {vessel.is_sanctioned ? (
          <button
            disabled={isPending}
            onClick={() =>
              act(
                () => setVesselSanctioned(vessel.id, false),
                "Vessel unsanctioned",
              )
            }
            className="w-full py-2.5 text-sm font-semibold text-green-600 bg-green-50 hover:bg-green-100 border border-green-200 rounded transition-colors disabled:opacity-50"
          >
            {isPending ? (
              <Loader2 className="w-4 h-4 animate-spin mx-auto" />
            ) : (
              "Remove sanctions flag"
            )}
          </button>
        ) : (
          <button
            disabled={isPending}
            onClick={() =>
              act(
                () => setVesselSanctioned(vessel.id, true),
                "Vessel sanctioned — hidden from all results",
              )
            }
            className="w-full py-2.5 text-sm font-semibold text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded transition-colors disabled:opacity-50"
          >
            {isPending ? (
              <Loader2 className="w-4 h-4 animate-spin mx-auto" />
            ) : (
              "Mark as sanctioned ⛔"
            )}
          </button>
        )}
        <p className="text-[10px] text-asb-gray-400 text-center mt-2">
          For Iranian-flagged or Sudan-linked vessels.
        </p>
      </ControlCard>

      {/* ── RISK LEVEL ──────────────────────────────────────── */}
      <ControlCard title="Risk level">
        <div className="grid grid-cols-2 gap-2 mb-3">
          {RISK_LEVELS.map(({ value, cls, activeCls }) => {
            const active = vessel.risk_level === value;
            return (
              <button
                key={value}
                disabled={active || isPending}
                onClick={() =>
                  act(
                    () => setVesselRisk(vessel.id, value, riskNotes),
                    `Risk set to ${value}`,
                  )
                }
                className={cn(
                  "py-2.5 text-xs font-bold rounded border transition-all disabled:opacity-60",
                  active ? activeCls : cls,
                )}
              >
                {value}
                {active && (
                  <span className="ml-1 text-[9px] font-normal opacity-70">
                    current
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-asb-gray-500 mb-1.5">
          Risk notes (shown to admin only)
        </p>
        <textarea
          value={riskNotes}
          onChange={(e) => {
            setRiskNotes(e.target.value);
            setRiskNotesDirty(true);
          }}
          rows={2}
          placeholder="Why this risk rating was assigned…"
          className="w-full text-sm px-3 py-2 rounded border border-asb-gray-200 resize-none focus:outline-none  focus:border-asb-blue placeholder:text-asb-gray-400"
        />
        {riskNotesDirty && (
          <button
            disabled={isPending}
            onClick={() => {
              startTransition(async () => {
                const r = await setVesselRisk(
                  vessel.id,
                  vessel.risk_level,
                  riskNotes,
                );
                if (r.success) {
                  toast.success("Risk notes saved");
                  setRiskNotesDirty(false);
                  router.refresh();
                } else toast.error(r.error ?? "Action failed.");
              });
            }}
            className="mt-1.5 w-full py-2 text-xs font-semibold text-asb-blue bg-asb-blue-light hover:bg-asb-blue-light border border-asb-blue rounded transition-colors disabled:opacity-50"
          >
            Save risk notes
          </button>
        )}
        <p className="text-[10px] text-asb-gray-400 mt-2">
          HIGH risk → all availability postings go to review queue regardless of
          trust tier.
        </p>
      </ControlCard>

      {/* ── SCOPE ───────────────────────────────────────────── */}
      <ControlCard title="DWT scope">
        <div className="space-y-2">
          {SCOPE_VALUES.map(({ value, cls, activeCls }) => {
            const active = vessel.scope === value;
            return (
              <button
                key={value}
                disabled={active || isPending}
                onClick={() =>
                  act(
                    () => setVesselScope(vessel.id, value),
                    `Scope set to ${value}`,
                  )
                }
                className={cn(
                  "w-full py-2.5 text-xs font-bold rounded border text-left px-4 transition-all disabled:opacity-60",
                  active ? activeCls : cls,
                )}
              >
                {value}
                {active && (
                  <span className="ml-1 opacity-70 font-normal text-[9px]">
                    current
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <p className="text-[10px] text-asb-gray-400 mt-2">
          Platform focuses on vessels under 30K DWT (In Scope).
        </p>
      </ControlCard>

      <ControlCard title="Internal notes">
        <textarea
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            setNotesDirty(true);
          }}
          rows={3}
          placeholder="Admin notes about this vessel…"
          className="w-full text-sm px-3 py-2.5 rounded border border-asb-gray-200 resize-none focus:outline-none  focus:border-asb-blue placeholder:text-asb-gray-400"
        />
        {notesDirty && (
          <button
            disabled={isPending}
            onClick={() => {
              startTransition(async () => {
                const r = await updateVesselNotes(vessel.id, notes);
                if (r.success) {
                  toast.success("Notes saved");
                  setNotesDirty(false);
                  router.refresh();
                } else toast.error(r.error ?? "Action failed.");
              });
            }}
            className="mt-2 w-full py-2 text-xs font-semibold text-asb-blue bg-asb-blue-light hover:bg-asb-blue-light border border-asb-blue rounded transition-colors disabled:opacity-50"
          >
            Save notes
          </button>
        )}
      </ControlCard>
    </div>
  );
}

function ControlCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-asb-gray-200 rounded overflow-hidden">
      <div className="px-5 py-3.5 border-b border-asb-gray-100">
        <h3 className="text-xs font-bold text-asb-gray-500 uppercase tracking-wider">
          {title}
        </h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}
