"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  ShieldOff,
  ShieldCheck,
  RotateCcw,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  setUserTrustTier,
  setUserActive,
  resetUserStrikes,
  resetUserCleanPosts,
  setUserRole,
  updateUserNotes,
} from "@/app/(admin)/admin/users/actions";
import type { AdminUserRow } from "@/lib/admin/types";

interface UserControlsProps {
  user: AdminUserRow;
}

export function UserControls({ user }: UserControlsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [notes, setNotes] = useState(user.notes ?? "");
  const [notesDirty, setNotesDirty] = useState(false);

  function act(
    fn: () => Promise<{ success: boolean; error?: string }>,
    successMsg: string,
  ) {
    startTransition(async () => {
      const result = await fn();
      if (result.success) {
        toast.success(successMsg);
        router.refresh();
      } else {
        toast.error(result.error ?? "Action failed.");
      }
    });
  }

  return (
    <div className="space-y-4">
      <ControlCard title="Trust tier">
        <p className="text-xs text-slate-500 mb-3">
          Manually override the trust tier. The system auto-upgrades at 5 clean
          posts and auto-downgrades at 2 strikes.
        </p>
        <div className="grid grid-cols-3 gap-2">
          {(["NEW", "VERIFIED", "FLAGGED"] as const).map((tier) => {
            const active = user.trust_tier === tier;
            const configs = {
              NEW: {
                icon: Clock,
                cls: active
                  ? "bg-slate-800 text-white border-slate-800"
                  : "border-slate-200 text-slate-600 hover:border-slate-400",
              },
              VERIFIED: {
                icon: CheckCircle2,
                cls: active
                  ? "bg-green-600 text-white border-green-600"
                  : "border-slate-200 text-slate-600 hover:border-green-400",
              },
              FLAGGED: {
                icon: AlertTriangle,
                cls: active
                  ? "bg-red-600 text-white border-red-600"
                  : "border-slate-200 text-slate-600 hover:border-red-400",
              },
            };
            const { icon: Icon, cls } = configs[tier];
            return (
              <button
                key={tier}
                disabled={active || isPending}
                onClick={() =>
                  act(
                    () => setUserTrustTier(user.id, tier),
                    `Trust tier set to ${tier}`,
                  )
                }
                className={cn(
                  "flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border text-xs font-bold transition-all disabled:opacity-60",
                  cls,
                )}
              >
                <Icon className="w-4 h-4" />
                {tier}
                {active && (
                  <span className="text-[9px] font-normal opacity-75">
                    current
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </ControlCard>

      <ControlCard title="Trust counters">
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-green-700">
              {user.clean_posts}
            </p>
            <p className="text-xs text-green-600 mt-0.5">Clean posts</p>
            <p className="text-[10px] text-green-500">5 = auto-VERIFIED</p>
          </div>
          <div
            className={cn(
              "border rounded-xl p-3 text-center",
              user.strike_count > 0
                ? "bg-red-50 border-red-200"
                : "bg-slate-50 border-slate-200",
            )}
          >
            <p
              className={cn(
                "text-2xl font-bold",
                user.strike_count > 0 ? "text-red-700" : "text-slate-500",
              )}
            >
              {user.strike_count}
            </p>
            <p
              className={cn(
                "text-xs mt-0.5",
                user.strike_count > 0 ? "text-red-600" : "text-slate-500",
              )}
            >
              Strikes
            </p>
            <p className="text-[10px] text-slate-400">2 = auto-FLAGGED</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            disabled={isPending || user.strike_count === 0}
            onClick={() =>
              act(() => resetUserStrikes(user.id), "Strike count reset to 0")
            }
            className="flex items-center justify-center gap-1.5 py-2 text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded-xl transition-colors disabled:opacity-40"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset strikes
          </button>
          <button
            disabled={isPending || user.clean_posts === 0}
            onClick={() =>
              act(() => resetUserCleanPosts(user.id), "Clean posts reset to 0")
            }
            className="flex items-center justify-center gap-1.5 py-2 text-xs font-semibold text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl transition-colors disabled:opacity-40"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset clean posts
          </button>
        </div>
      </ControlCard>

      <ControlCard title="Role">
        <p className="text-xs text-slate-500 mb-2">
          Changing role affects which parts of the dashboard the user can
          access.
        </p>
        <select
          defaultValue={user.role}
          disabled={isPending}
          onChange={(e) => {
            const role = e.target.value as
              | "cargo_owner"
              | "vessel_owner"
              | "broker";
            act(() => setUserRole(user.id, role), `Role updated to ${role}`);
          }}
          className="w-full h-9 text-sm px-3 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-ocean-500 cursor-pointer"
        >
          <option value="cargo_owner">cargo_owner</option>
          <option value="vessel_owner">vessel_owner</option>
          <option value="broker">broker</option>
        </select>
      </ControlCard>

      <ControlCard title="Account status">
        {user.is_active ? (
          <button
            disabled={isPending}
            onClick={() =>
              act(() => setUserActive(user.id, false), "Account suspended")
            }
            className="w-full flex items-center gap-2 justify-center py-2.5 text-sm font-semibold text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded-xl transition-colors disabled:opacity-50"
          >
            {isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ShieldOff className="w-4 h-4" />
            )}
            Suspend account
          </button>
        ) : (
          <button
            disabled={isPending}
            onClick={() =>
              act(() => setUserActive(user.id, true), "Account restored")
            }
            className="w-full flex items-center gap-2 justify-center py-2.5 text-sm font-semibold text-green-600 bg-green-50 hover:bg-green-100 border border-green-200 rounded-xl transition-colors disabled:opacity-50"
          >
            {isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ShieldCheck className="w-4 h-4" />
            )}
            Restore account
          </button>
        )}
        <p className="text-[11px] text-slate-400 mt-2 text-center">
          {user.is_active
            ? "Suspending blocks login and all submissions."
            : "Account is currently suspended."}
        </p>
      </ControlCard>

      <ControlCard title="Admin notes">
        <textarea
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            setNotesDirty(true);
          }}
          rows={3}
          placeholder="Internal notes about this user…"
          className="w-full text-sm px-3 py-2.5 rounded-xl border border-slate-200 bg-white resize-none focus:outline-none focus:ring-2 focus:ring-ocean-500 placeholder:text-slate-400"
        />
        {notesDirty && (
          <button
            disabled={isPending}
            onClick={() => {
              act(() => updateUserNotes(user.id, notes), "Notes saved");
              setNotesDirty(false);
            }}
            className="mt-2 w-full py-2 text-xs font-semibold text-ocean-600 bg-ocean-50 hover:bg-ocean-100 border border-ocean-200 rounded-xl transition-colors disabled:opacity-50"
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
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-100">
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
          {title}
        </h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}
