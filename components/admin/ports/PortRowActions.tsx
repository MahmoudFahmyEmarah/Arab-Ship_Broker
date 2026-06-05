"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, EyeOff, Eye, Loader2 } from "lucide-react";
import { verifyPort, setPortActive } from "@/app/(admin)/admin/ports/actions";
import type { AdminPortRow } from "@/lib/admin/types";

interface PortRowActionsProps {
  port: AdminPortRow;
}

export function PortRowActions({ port }: PortRowActionsProps) {
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
    <div className="flex items-center gap-2 flex-wrap">
      {!port.is_verified && (
        <button
          disabled={isPending}
          onClick={() =>
            act(() => verifyPort(port.locode), `${port.trade_name} verified`)
          }
          className="flex items-center gap-1.5 text-xs font-semibold text-green-700 bg-green-50 hover:bg-green-100 border border-green-200 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50"
        >
          {isPending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5" />
          )}
          Verify
        </button>
      )}

      {port.is_active ? (
        <button
          disabled={isPending}
          onClick={() =>
            act(
              () => setPortActive(port.locode, false),
              `${port.trade_name} deactivated`,
            )
          }
          className="flex items-center gap-1.5 text-xs font-semibold text-asb-gray-500 hover:text-red-600 hover:bg-red-50 border border-asb-gray-200 hover:border-red-200 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50"
        >
          <EyeOff className="w-3.5 h-3.5" />
          Deactivate
        </button>
      ) : (
        <button
          disabled={isPending}
          onClick={() =>
            act(
              () => setPortActive(port.locode, true),
              `${port.trade_name} reactivated`,
            )
          }
          className="flex items-center gap-1.5 text-xs font-semibold text-green-600 bg-green-50 hover:bg-green-100 border border-green-200 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50"
        >
          <Eye className="w-3.5 h-3.5" />
          Reactivate
        </button>
      )}
    </div>
  );
}
