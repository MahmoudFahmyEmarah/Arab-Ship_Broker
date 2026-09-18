-- Data Sync hardening (10 Sep 2026) — findings from the module's security /
-- performance audit. Everything here is additive and reversible.
--
-- S1  Three SECURITY DEFINER functions were executable by anon/authenticated:
--       fn_port_review_sweep()  — no auth check; any visitor could scan every
--                                 listing + staged row and write the port queue.
--       resolve_port_review()   — has an fn_is_admin() guard, but only the
--                                 service role ever calls it; close it anyway.
--       fn_contacts_overview()  — no auth check; returned the whole contacts
--                                 registry (emails, phones) to any signed-in
--                                 member via /rest/v1/rpc. This is the GDPR
--                                 record — it is read by an admin action only.
-- P1  stageBatch's "what did this source say last time" lookup seq-scanned
--     sync_staged_row (1.07 s per 500-key chunk at 6k rows). Index it, plus
--     the foreign keys the advisor flagged on the queue/audit tables.
-- F1  Nightly inbox schedule switches for /api/cron/email-sync.

-- ── S1 · close the exposed RPCs ─────────────────────────────────────────────
revoke all on function public.fn_port_review_sweep()                        from public, anon, authenticated;
revoke all on function public.resolve_port_review(uuid, text, text, text, text, text, text[]) from public, anon, authenticated;
revoke all on function public.fn_contacts_overview(text, integer)            from public, anon, authenticated;
grant execute on function public.fn_port_review_sweep()                     to service_role;
grant execute on function public.resolve_port_review(uuid, text, text, text, text, text, text[]) to service_role;
grant execute on function public.fn_contacts_overview(text, integer)         to service_role;

-- ── P1 · indexes ────────────────────────────────────────────────────────────
-- stage.ts step 2c: latest COMMITTED payload per business key for a table
create index if not exists idx_staged_prev_committed
  on public.sync_staged_row (target_table, business_key, created_at desc)
  where committed;
-- Review / commit loops: uncommitted rows of a batch by classification
create index if not exists idx_staged_batch_class_open
  on public.sync_staged_row (batch_id, classification)
  where not committed;
-- latestReviewBatch + the Intake list: newest batches by status
create index if not exists idx_sync_batch_status_created
  on public.sync_batch (status, created_at desc);
-- FK covers flagged by the performance advisor
create index if not exists idx_sync_commit_audit_staged   on public.sync_commit_audit (staged_row_id);
create index if not exists idx_wa_msg_batch               on public.whatsapp_message (batch_id) where batch_id is not null;
create index if not exists idx_wa_outbox_message          on public.whatsapp_outbox (message_id) where message_id is not null;
create index if not exists idx_vrq_first_batch            on public.vessel_review_queue (first_batch_id);
create index if not exists idx_vrq_resolved_vessel        on public.vessel_review_queue (resolved_vessel_id) where resolved_vessel_id is not null;
create index if not exists idx_crq_first_batch            on public.commodity_review_queue (first_batch_id);
create index if not exists idx_prq_mapped_locode          on public.port_review_queue (mapped_locode) where mapped_locode is not null;

-- ── F1 · nightly inbox schedule ─────────────────────────────────────────────
alter table public.email_ingest_config
  add column if not exists schedule_enabled boolean not null default false,
  add column if not exists schedule_label   text    not null default 'Nightly 02:00 UTC';

comment on column public.email_ingest_config.schedule_enabled is
  'When true, /api/cron/email-sync (vercel.json, 02:00 UTC) runs the inbox sync unattended. The connection itself must also be enabled.';
