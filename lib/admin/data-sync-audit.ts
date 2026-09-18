// Data Sync audit trail writer — "who did what, when" for every mutation in
// the module (public.data_sync_audit). Service role only; a failed audit write
// is logged to the server console and NEVER fails the action it describes.
//
// This module must stay free of next/headers (it is reached from server
// actions, route handlers and, through them, the Pages-Router error page):
// route handlers pass the request context in via requestContext(req.headers);
// server actions log without ip / user-agent.
//
// Actions are dotted, stable identifiers the UI groups and filters on:
//   batch.commit · batch.commit_selection · batch.undo · batch.discard
//   row.edit · row.merge · row.restore
//   record.edit · record.insert · record.delete · record.bulk_edit · record.bulk_delete · record.undo
//   queue.commodity.resolve · queue.commodity.ignore · queue.vessel.sync · queue.vessel.patch · queue.vessel.ignore
//   queue.port.resolve · queue.port.ignore · queue.port.sweep · positions.post
//   run.upload · run.email · run.email.dry_run · run.email.cron · run.whatsapp.sweep · run.whatsapp.simulate
//   whatsapp.message.delete · whatsapp.inbox.clear · whatsapp.teaser · whatsapp.worker.start · whatsapp.worker.stop
//   settings.llm.save · settings.llm.activate · settings.llm.delete · settings.llm.test · settings.llm.import
//   settings.email.save · settings.email.schedule · settings.email.watermark · settings.whatsapp.save
import type { SupabaseClient } from "@supabase/supabase-js";

export type AuditActorKind = "admin" | "cron" | "webhook" | "system";

export interface AuditContext { ip: string | null; userAgent: string | null }

export interface AuditEntry {
  action: string;
  summary: string;
  actor?: { id: string | null; name: string | null; kind?: AuditActorKind } | null;
  targetKind?: string | null;
  targetId?: string | null;
  batchId?: string | null;
  detail?: Record<string, unknown>;
  ok?: boolean;
  /** Route handlers pass the request's ip / user-agent; server actions omit it. */
  ctx?: AuditContext | null;
}

/** Request context for route handlers, from the incoming Headers. */
export function requestContext(h: Headers): AuditContext {
  const fwd = h.get("x-forwarded-for");
  return {
    ip: (fwd ? fwd.split(",")[0].trim() : h.get("x-real-ip")) || null,
    userAgent: h.get("user-agent")?.slice(0, 200) ?? null,
  };
}

export async function logAudit(sb: SupabaseClient, e: AuditEntry): Promise<void> {
  try {
    const ctx = e.ctx ?? { ip: null, userAgent: null };
    const { error } = await sb.from("data_sync_audit").insert({
      actor_id: e.actor?.id ?? null,
      actor_name: e.actor?.name ?? null,
      actor_kind: e.actor?.kind ?? (e.actor ? "admin" : "system"),
      action: e.action,
      target_kind: e.targetKind ?? null,
      target_id: e.targetId ?? null,
      batch_id: e.batchId ?? null,
      summary: e.summary.slice(0, 500),
      detail: e.detail ?? {},
      ok: e.ok ?? true,
      ip: ctx.ip,
      user_agent: ctx.userAgent,
    });
    if (error) console.error("[data-sync audit]", e.action, error.message);
  } catch (err) {
    console.error("[data-sync audit]", e.action, err instanceof Error ? err.message : err);
  }
}

/** The stored row, as read back by the History → Audit trail view. */
export interface AuditRow {
  id: number;
  at: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_kind: AuditActorKind;
  action: string;
  target_kind: string | null;
  target_id: string | null;
  batch_id: string | null;
  summary: string;
  detail: Record<string, unknown>;
  ok: boolean;
  ip: string | null;
}

/** Human labels for the action families, in the order the filter shows them. */
export const AUDIT_FAMILIES: { id: string; label: string }[] = [
  { id: "batch", label: "Batches" },
  { id: "row", label: "Staged rows" },
  { id: "record", label: "Database edits" },
  { id: "queue", label: "Queues" },
  { id: "run", label: "Runs" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "settings", label: "Connections" },
  { id: "positions", label: "Positions" },
];
