-- ════════════════════════════════════════════════════════════════════════
-- Data Sync hardening · phase 0 (18 Sep 2026)
--
-- commit_sync_batch's exception handler does
--     update sync_batch set status = 'failed', error = SQLERRM; raise;
-- and the raise aborts the transaction that update sits in — together with
-- the earlier "committing" write. A failed commit therefore left the batch
-- looking untouched and threw the error text away. The handler stays as it is
-- (it cannot work, and the comment on it now says so); the application calls
-- this function in a SECOND statement after the RPC fails.
-- Idempotent.
-- ════════════════════════════════════════════════════════════════════════

create or replace function public.mark_sync_batch_failed(p_batch_id uuid, p_error text)
 returns void language sql volatile security definer set search_path to ''
as $$
  update public.sync_batch
     set status = 'failed',
         error  = left(coalesce(p_error, 'commit failed'), 2000)
   where id = p_batch_id
     and status not in ('committed', 'undone');
$$;

revoke all on function public.mark_sync_batch_failed(uuid, text) from public, anon, authenticated;
grant execute on function public.mark_sync_batch_failed(uuid, text) to service_role;

comment on function public.mark_sync_batch_failed(uuid, text) is
  'Records a failed commit from the application after commit_sync_batch raised — the in-function status write rolls back with the error.';

comment on function public.commit_sync_batch(uuid, text, uuid[]) is
  'Commits the staged rows of a batch. NOTE: the "failed" write in its exception handler rolls back with the raise; the caller records failure through mark_sync_batch_failed.';
