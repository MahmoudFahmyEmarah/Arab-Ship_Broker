// POST /api/sync/email — run an email→LLM sync and stream progress as SSE.
// Body: { limit?: number }            → live IMAP sync of the configured inbox
//       { sample: string }            → dry run: classify one pasted email
// Owner-only (Data Sync section, edit). Node runtime (imapflow + LangChain).

import { requireAdmin } from "@/lib/admin/require-admin";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { runEmailSync, runEmailDryRun } from "@/lib/sync/email/run";
import type { SyncEvent } from "@/lib/sync/email/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  let admin: Awaited<ReturnType<typeof requireAdmin>>;
  try {
    admin = await requireAdmin({ section: "datasync", edit: true });
  } catch {
    return new Response(JSON.stringify({ error: "Not authorized." }), {
      status: 403, headers: { "Content-Type": "application/json" },
    });
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const sample = typeof body.sample === "string" ? body.sample : null;
  const limit = Math.min(Math.max(Number(body.limit) || 25, 1), 100);
  const supabase = getSupabaseAdminClient();

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const emit = (e: SyncEvent) => {
        try { controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`)); } catch { /* closed */ }
      };
      try {
        if (sample) await runEmailDryRun({ supabase, sampleText: sample, emit });
        else await runEmailSync({ supabase, limit, emit, startedBy: admin.rowId });
      } catch (e) {
        emit({ type: "error", error: e instanceof Error ? e.message : "Email sync failed." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
