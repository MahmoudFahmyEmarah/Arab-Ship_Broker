-- ════════════════════════════════════════════════════════════════════════
-- Live cargo is routable — the table constraint (17 Sep 2026)
--
-- Backstop for trg_cl_zy_live_route_gate (20260917120000): the same rule as a
-- CHECK constraint, so it holds even if the trigger is ever disabled.
--
-- It REFUSES TO APPLY while any live, approved cargo is unroutable, and names
-- them: a NOT VALID check still fires on every later update of such a row,
-- which would make it un-editable with a cryptic message. Close or place
-- those rows first (at 17 Sep: EM-5C764B40, Izmail → "Israel", laycan closed
-- 31 Aug — close it, or add an Israeli port to the registry and nominate it
-- on the area), then push again. Idempotent.
-- ════════════════════════════════════════════════════════════════════════

do $$
declare n int; v_refs text;
begin
  select count(*), string_agg(ref, ', ' order by ref)
    into n, v_refs
    from public.cargo_listings
   where status in ('IN', 'PARTIAL') and review_status = 'APPROVED'
     and (public.fn_cl_effective_locode(load_port_locode,  load_ref_locode,  load_port_2_locode)  is null
       or public.fn_cl_effective_locode(disch_port_locode, disch_ref_locode, disch_port_2_locode) is null);
  if n > 0 then
    raise exception 'cargo_live_routable_ck: % live approved cargo are still unroutable (%). Close or place them (Data quality → Issues → DQ-C05), then apply this migration again.', n, v_refs;
  end if;
end $$;

alter table public.cargo_listings drop constraint if exists cargo_listings_live_routable_ck;
alter table public.cargo_listings add constraint cargo_listings_live_routable_ck check (
  not (status in ('IN', 'PARTIAL') and review_status = 'APPROVED')
  or (
    public.fn_cl_effective_locode(load_port_locode,  load_ref_locode,  load_port_2_locode)  is not null
    and public.fn_cl_effective_locode(disch_port_locode, disch_ref_locode, disch_port_2_locode) is not null
  )
) not valid;

alter table public.cargo_listings validate constraint cargo_listings_live_routable_ck;

comment on constraint cargo_listings_live_routable_ck on public.cargo_listings is
  'A live, approved cargo resolves to a LOCODE on both sides (own code, reference port, or slot 2). Backstop for trg_cl_zy_live_route_gate.';
