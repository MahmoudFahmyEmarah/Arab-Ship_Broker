"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ADMIN_PRESETS, ADMIN_PRESET_ORDER } from "@/lib/admin/sections";
import { promoteToSubAdmin, demoteSubAdmin } from "./actions";

export function PromoteControl({ userId }: { userId: string }) {
  const [preset, setPreset] = useState("broker");
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-2">
      <select
        value={preset}
        onChange={(e) => setPreset(e.target.value)}
        className="h-8 text-xs px-2 rounded border border-asb-gray-200 bg-white focus:outline-none focus:border-asb-blue"
      >
        {ADMIN_PRESET_ORDER.map((k) => (
          <option key={k} value={k}>{ADMIN_PRESETS[k].label}</option>
        ))}
      </select>
      <button
        disabled={pending}
        onClick={() => start(async () => {
          const r = await promoteToSubAdmin(userId, preset);
          if (r.success) toast.success("Promoted to sub-admin");
          else toast.error(r.error);
        })}
        className="px-3 h-8 text-xs font-semibold bg-asb-blue hover:bg-asb-navy text-white rounded transition-colors disabled:opacity-60"
      >
        {pending ? "…" : "Promote"}
      </button>
    </div>
  );
}

export function DemoteControl({ userId }: { userId: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() => {
        if (!window.confirm("Remove this sub-admin's access?")) return;
        start(async () => {
          const r = await demoteSubAdmin(userId);
          if (r.success) toast.success("Sub-admin removed");
          else toast.error(r.error);
        });
      }}
      className="px-3 h-8 text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded transition-colors disabled:opacity-60"
    >
      {pending ? "…" : "Demote"}
    </button>
  );
}
