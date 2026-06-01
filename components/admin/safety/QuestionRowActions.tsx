"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { EyeOff, Eye, Loader2 } from "lucide-react";
import { setSafetyQuestionActive } from "@/app/(admin)/admin/safety-questions/actions";

type Q = { id: string; question_key: string; is_active: boolean };

export function QuestionRowActions({ question: q }: { question: Q }) {
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

  return q.is_active ? (
    <button
      disabled={isPending}
      onClick={() =>
        act(
          () => setSafetyQuestionActive(q.id, false),
          `"${q.question_key}" deactivated`,
        )
      }
      className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-red-600 hover:bg-red-50 border border-slate-200 hover:border-red-200 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50"
    >
      {isPending ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : (
        <EyeOff className="w-3.5 h-3.5" />
      )}
      Deactivate
    </button>
  ) : (
    <button
      disabled={isPending}
      onClick={() =>
        act(
          () => setSafetyQuestionActive(q.id, true),
          `"${q.question_key}" reactivated`,
        )
      }
      className="flex items-center gap-1.5 text-xs font-semibold text-green-600 bg-green-50 hover:bg-green-100 border border-green-200 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50"
    >
      {isPending ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : (
        <Eye className="w-3.5 h-3.5" />
      )}
      Reactivate
    </button>
  );
}
