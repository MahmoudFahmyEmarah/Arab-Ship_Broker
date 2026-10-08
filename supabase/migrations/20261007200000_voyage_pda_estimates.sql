-- ════════════════════════════════════════════════════════════════════════
-- Stream S · the Voyage estimator takes a port DA from a saved PDA estimate (7 Oct 2026, B2O-020 P2 / Wave 3)
--
-- list_voyage_pda_estimates(port): the calling member's own readable PDA estimates for one port
-- (fn_can_read_pda_estimate: owner, a current active seat of the owning organisation, or an admin),
-- newest first, superseded ones left out. Only what the picker needs: id, call date, coverage, terminal,
-- the USD total when the estimate has one (native USD or converted to USD), generated_at.
-- The save reads the chosen estimate through get_pda_estimate (the PDA module's own authorised read).
--
-- Additive; idempotent. DOWN: supabase/rollback/20261003_suez_voyage_down.sql
-- ════════════════════════════════════════════════════════════════════════

create or replace function public.list_voyage_pda_estimates(p_port_locode text)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $list$
  select coalesce(jsonb_agg(x order by x ->> 'generatedAt' desc), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'id', e.id, 'callDate', e.call_date, 'coverage', e.coverage, 'terminalName', e.terminal_name,
               'usdTotal', case when e.native_currency = 'USD' then e.native_total when e.converted_currency = 'USD' then e.converted_total end,
               'currency', e.native_currency, 'generatedAt', e.generated_at) as x
        from public.pda_estimates e
       where p_port_locode ~ '^[A-Z]{2}[A-Z0-9]{3}$'
         and e.port_locode = p_port_locode
         and not exists (select 1 from public.pda_estimates s where s.supersedes_id = e.id)
         and public.fn_can_read_pda_estimate(e.id)
       order by e.generated_at desc
       limit 20) q;
$list$;
revoke all on function public.list_voyage_pda_estimates(text) from public, anon, service_role;
grant execute on function public.list_voyage_pda_estimates(text) to authenticated;
comment on function public.list_voyage_pda_estimates(text) is
  'Voyage estimator: the member''s own readable, current PDA estimates for one port (picker for the port DA).';
