-- ════════════════════════════════════════════════════════════════════════
-- Fixture Room · the recap PDF binding read (C2O-111 P1, C2O-113; 17 Oct 2026). Follows released Wave 6
-- (20261012100000_fixture_extension_authority_first); nothing released is edited.
--
-- fixture_recap_pdf_binding(recap version): a service-only read of an existing binding, so the store reads it BEFORE
-- rendering and retries a pending/failed binding with the renderer recorded on it (recap-pdf/2 bindings exist in
-- production since Wave 5; renderer recap-pdf/3 is for new bindings only). The append-only binding table, its
-- trigger and the bind/finalize RPCs are unchanged.
--
-- Plain SQL only (no psql meta, no storage writes). DOWN: supabase/rollback/20261017100000_fixture_recap_pdf_binding_read_down.sql
-- ════════════════════════════════════════════════════════════════════════
set local lock_timeout = '5s';

create or replace function public.fixture_recap_pdf_binding(p_recap_version_id uuid)
 returns jsonb language sql stable security definer set search_path to ''
as $$
  select jsonb_build_object('recapVersionId', b.recap_version_id, 'roomId', b.room_id, 'path', b.storage_path,
                            'sha256', b.sha256, 'bytes', b.bytes, 'renderer', b.renderer, 'status', b.status)
    from public.fixture_recap_pdfs b
   where b.recap_version_id = p_recap_version_id;
$$;
revoke all on function public.fixture_recap_pdf_binding(uuid) from public, anon, authenticated;
grant execute on function public.fixture_recap_pdf_binding(uuid) to service_role;
