// POST /api/sync/email — run an email→LLM sync and stream progress as SSE.
// Body: { limit?: number, since?: ISO } → live IMAP sync of the configured inbox (since = start point override)
//       { sample: string }            → dry run: classify one pasted email
// Owner-only (Data Sync section, edit). Node runtime (imapflow + LangChain).
//
// P1-2 (20 Sep 2026): the job's terminal status and the audit entry are
// written once, awaited, in the finalisation path — whether the client is
// still listening or went away mid-stream. A run never stays "running".

import { requireAdmin } from "@/lib/admin/require-admin";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { runEmailSync, runEmailDryRun } from "@/lib/sync/email/run";
import { RunSettler } from "@/lib/sync/email/finalize";
import type { SyncEvent } from "@/lib/sync/email/types";
import { startJobRun } from "@/lib/jobs/runs";
import { logAudit, requestContext } from "@/lib/admin/data-sync-audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  let admin: Awaited<ReturnType<typeof requireAdmin>>;
  try {
    admin = await requireAdmin({ section: "datasync", edit: true });
  } catch {
    // requireAdmin denies by redirect(); an API route answers with JSON instead.
    return new Response(JSON.stringify({ error: "Not authorized." }), {
      status: 403, headers: { "Content-Type": "application/json" },
    });
  }
  // Body cap: a pasted sample is a few KB; refuse anything absurd before parsing.
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > 256 * 1024) return new Response(JSON.stringify({ error: "Request body too large." }), { status: 413, headers: { "Content-Type": "application/json" } });

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const sample = typeof body.sample === "string" ? body.sample : null;
  const limit = Math.min(Math.max(Number(body.limit) || 25, 1), 100);
  const sinceRaw = typeof body.since === "string" ? new Date(body.since) : null;
  const since = sinceRaw && !Number.isNaN(sinceRaw.getTime()) && sinceRaw.getTime() < Date.now() ? sinceRaw : null;
  const supabase = getSupabaseAdminClient();
  const ctx = requestContext(req.headers);

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      // Live runs leave a job_runs row; the settler records the first
      // done / empty / skipped / error event and writes it once at the end.
      const runId = sample ? null : await startJobRun(supabase, "email-sync", { trigger: "admin", meta: { limit, since: since?.toISOString() ?? null } });
      const settler = new RunSettler();
      const emit = (e: SyncEvent) => {
        settler.note(e);
        // A closed stream (client gone) does not stop the run: it finishes and
        // is finalised below all the same.
        try { controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`)); } catch { /* closed */ }
      };
      try {
        if (sample) await runEmailDryRun({ supabase, sampleText: sample, emit });
        else await runEmailSync({ supabase, limit, emit, startedBy: admin.rowId, since, owner: `admin:${admin.fullName ?? admin.rowId}`, budgetMs: 240_000, maxPages: 6 });
      } catch (e) {
        emit({ type: "error", error: e instanceof Error ? e.message : "Email sync failed." });
      } finally {
        const settle = await settler.finish(supabase, runId);
        await logAudit(supabase, {
          actor: { id: admin.rowId, name: admin.fullName }, ctx,
          action: sample ? "run.email.dry_run" : "run.email", targetKind: "run", targetId: runId != null ? String(runId) : null,
          batchId: (settle.meta as { batch_id?: string } | undefined)?.batch_id ?? null,
          summary: sample
            ? (settle.ok ? `Dry run on a pasted email — ${settle.rows ?? 0} record(s) staged` : `Dry run on a pasted email failed — ${settle.error}`)
            : (settle.ok ? `Inbox sync — ${settle.rows ?? 0} record(s) staged${since ? ` (start point ${since.toISOString().slice(0, 16).replace("T", " ")} UTC)` : ""}` : `Inbox sync failed — ${settle.error}`),
          ok: settle.ok, detail: { limit, since: since?.toISOString() ?? null, rows: settle.rows, error: settle.error ?? null },
        });
        try { controller.close(); } catch { /* already closed */ }
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
