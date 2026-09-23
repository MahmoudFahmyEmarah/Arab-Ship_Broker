-- ════════════════════════════════════════════════════════════════════════
-- Live cargo must be routable on both sides (17 Sep 2026)
--
-- The port identity layer (10 Sep) classifies every port side and nominates a
-- reference port for areas, and the market shows three explicit states:
--   exact      port → port
--   estimated  an area / option list resolved through its reference port
--   invalid    a side with no LOCODE and no reference port
-- Until today nothing REFUSED the third shape from going live: DQ-C05 only
-- warns, and the member-form LOCODE requirement is one write path of six.
-- Audit of the live database before this migration: 1,632 approved live cargo
-- = 1,473 exact + 158 estimated + 1 invalid (EM-5C764B40, Izmail → "Israel",
-- an area with no reference port and no Israeli port in the registry).
--
--   trg_cl_zy_live_route_gate   BEFORE INSERT / UPDATE on cargo_listings.
--       When a row BECOMES live-and-approved, or a live row's port sides
--       change, both sides must carry an effective LOCODE (own code, the
--       area's reference port, or the LOCODE in slot 2). Otherwise the write
--       is refused with a plain-language ROUTE_GATE message. Protects every
--       ingestion path: forms, the v1/v2 posting RPCs, sync, the circular
--       pipeline, Manual Review, the review-queue approval trigger and
--       admin edits. A row that is already live keeps working (it can be
--       closed, re-priced, rejected); it is simply not allowed to stay
--       unroutable if its ports are edited.
--   fn_cl_effective_locode(...) the one definition of "routable", shared by
--       the trigger and the CHECK constraint (20260917130000).
--   cargo_listings_load_ref_locode_fkey / _disch_ref_locode_fkey
--       the reference columns now point at ports like the primary and slot-2
--       columns do, so "effective LOCODE" means a real port, not any text.
--       Live audit 17 Sep: 0 dangling references in 1,833 rows, so the keys
--       are validated here.
--   cargo_listings_live_routable_ck
--       the same rule as a table constraint — the backstop if the trigger
--       is ever disabled. Lives in the NEXT migration (20260917130000), which
--       refuses to apply while any live row is unroutable: a NOT VALID check
--       would still fire on every update of such a row.
--   trg_*_zz_dq_gate            the central data-quality gate on the member
--       forms: every authenticated write to cargo_listings, vessel_availability
--       and vessels is evaluated by fn_dq_validate on the 'forms' channel
--       (or the channel named in the dq.channel setting — a partner API sets
--       'api'). Shadow mode by default: blocks are logged to dq_gate_log and
--       visible in Data quality → Gate, nothing is refused. Flip
--       dq_settings.gate_forms_enforce to refuse; then the gate FAILS CLOSED —
--       if fn_dq_validate cannot run, OR any single rule fails to evaluate
--       (its errors counter), the write is refused. Service-role writes
--       (sync, pipeline, admin pages) and administrators' own sessions
--       (review-queue approval, admin edits) are skipped here: those paths
--       call the gate themselves with their own channel, and must not be
--       judged a second time on the forms channel.
--       Known limit: when enforcing, the refusal rolls back with the
--       transaction, dq_gate_log entry included. Shadow-mode logs persist.
--       The member sees the DQ_GATE message; app-side logging of refusals
--       is a follow-up.
-- Trigger names sort after trg_cl_port_autofill so the scope and reference
-- port are already filled in when they run. Idempotent.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1 · "routable" — one definition ─────────────────────────────────────────
create or replace function public.fn_cl_effective_locode(p_locode text, p_ref text, p_slot2 text)
 returns text language sql immutable set search_path to ''
as $$
  select coalesce(nullif(btrim(p_locode), ''), nullif(btrim(p_ref), ''), nullif(btrim(p_slot2), ''));
$$;
comment on function public.fn_cl_effective_locode(text, text, text) is
  'The LOCODE a cargo side feeds to distance / Voy OPEX / Ports DA: its own code, else the area''s reference port, else the code in slot 2.';

-- The reference columns were added on 10 Sep without a foreign key, unlike the
-- primary and slot-2 columns. A hand-typed reference must be a real port.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cargo_listings_load_ref_locode_fkey') then
    alter table public.cargo_listings
      add constraint cargo_listings_load_ref_locode_fkey
      foreign key (load_ref_locode) references public.ports(locode) on update cascade not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cargo_listings_disch_ref_locode_fkey') then
    alter table public.cargo_listings
      add constraint cargo_listings_disch_ref_locode_fkey
      foreign key (disch_ref_locode) references public.ports(locode) on update cascade not valid;
  end if;
end $$;
alter table public.cargo_listings validate constraint cargo_listings_load_ref_locode_fkey;
alter table public.cargo_listings validate constraint cargo_listings_disch_ref_locode_fkey;

-- ── 2 · the live route gate ─────────────────────────────────────────────────
create or replace function public.fn_cl_live_route_gate()
 returns trigger language plpgsql set search_path to 'public'
as $function$
declare
  v_live     boolean;
  v_was_live boolean;
  v_ports_changed boolean;
  v_load  text;
  v_disch text;
  v_missing text[] := '{}';
begin
  v_live := new.status in ('IN', 'PARTIAL') and new.review_status = 'APPROVED';
  if not v_live then
    return new;
  end if;

  v_was_live := tg_op = 'UPDATE'
                and old.status in ('IN', 'PARTIAL') and old.review_status = 'APPROVED';
  v_ports_changed := tg_op = 'INSERT' or not v_was_live
     or old.load_port_locode    is distinct from new.load_port_locode
     or old.load_port_name      is distinct from new.load_port_name
     or old.load_ref_locode     is distinct from new.load_ref_locode
     or old.load_port_2_locode  is distinct from new.load_port_2_locode
     or old.disch_port_locode   is distinct from new.disch_port_locode
     or old.disch_port_name     is distinct from new.disch_port_name
     or old.disch_ref_locode    is distinct from new.disch_ref_locode
     or old.disch_port_2_locode is distinct from new.disch_port_2_locode;
  -- a live row being re-priced, closed or otherwise edited is left alone
  if not v_ports_changed then
    return new;
  end if;

  v_load  := fn_cl_effective_locode(new.load_port_locode,  new.load_ref_locode,  new.load_port_2_locode);
  v_disch := fn_cl_effective_locode(new.disch_port_locode, new.disch_ref_locode, new.disch_port_2_locode);
  if v_load is null then
    v_missing := v_missing || format('the load side (%s)', coalesce(nullif(btrim(new.load_port_name), ''), 'no port given'));
  end if;
  if v_disch is null then
    v_missing := v_missing || format('the discharge side (%s)', coalesce(nullif(btrim(new.disch_port_name), ''), 'no port given'));
  end if;
  if array_length(v_missing, 1) > 0 then
    raise exception 'ROUTE_GATE: this cargo cannot go live — % has no port and no reference port. Name a port, or place the text in Data Sync → Manual Review → Ports (as a port alias, or as an area with a nominated reference port).',
      array_to_string(v_missing, ' and ')
      using errcode = 'check_violation',
            hint = 'A live cargo must resolve to a LOCODE on both sides so the market can show distance, Voy OPEX and Ports DA.';
  end if;
  return new;
end $function$;

drop trigger if exists trg_cl_zy_live_route_gate on public.cargo_listings;
create trigger trg_cl_zy_live_route_gate
  before insert or update on public.cargo_listings
  for each row execute function public.fn_cl_live_route_gate();

comment on function public.fn_cl_live_route_gate() is
  'Refuses a cargo becoming live + approved (or a live one whose ports change) unless both sides resolve to a LOCODE — own code, reference port, or slot 2. ROUTE_GATE: prefix on the message.';

-- ── 3 · the central DQ gate on member forms (shadow by default) ─────────────
alter table public.dq_settings
  add column if not exists gate_forms_enforce boolean not null default false;
comment on column public.dq_settings.gate_forms_enforce is
  'false: forms-channel blocks are logged to dq_gate_log only (shadow). true: the write is refused, and the gate fails closed when it cannot evaluate.';

create or replace function public.fn_dq_forms_gate()
 returns trigger language plpgsql security definer set search_path to ''
as $function$
declare
  v_claims  jsonb;
  v_channel text;
  v_enforce boolean;
  v_gate    jsonb;
  v_why     text;
  v_actor   text;
  v_actor_id uuid;
begin
  v_channel := nullif(current_setting('dq.channel', true), '');
  begin
    v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  exception when others then
    v_claims := null;
  end;
  if v_channel is null then
    -- a signed-in MEMBER writing through PostgREST (Post Cargo, Post Position,
    -- Register Vessel, My Vessels). Service-role paths gate themselves, and an
    -- administrator's own session (review-queue approval, admin edits) is
    -- gated explicitly on its own channel — never judged again as a form.
    if coalesce(v_claims->>'role', '') = 'authenticated' and not public.fn_is_admin() then
      v_channel := 'forms';
    else
      return new;
    end if;
  end if;

  select coalesce(s.gate_forms_enforce, false) into v_enforce from public.dq_settings s where s.id = 1;
  v_enforce := coalesce(v_enforce, false);
  v_actor := coalesce(v_claims->>'email', v_channel);
  if (v_claims->>'sub') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_actor_id := (v_claims->>'sub')::uuid;
  end if;

  begin
    v_gate := public.fn_dq_validate(tg_table_name::text, to_jsonb(new), v_channel, v_actor, v_actor_id, true);
  exception when others then
    if v_enforce then
      -- fail closed: an unavailable gate is not a pass
      raise exception 'DQ_GATE: the data-quality gate could not run (%). Nothing was saved — please try again, or ask an administrator.', sqlerrm
        using errcode = 'check_violation';
    end if;
    return new;
  end;

  if v_enforce and coalesce((v_gate->>'errors')::integer, 0) > 0 then
    -- fail closed: a rule that could not be evaluated is not a pass. The rule
    -- is named in dq_gate_log (mode "error") — this write's own log entry
    -- rolls back with it, earlier shadow-mode entries do not.
    raise exception 'DQ_GATE: % data-quality rule(s) could not be evaluated, so the write was refused. Nothing was saved — try again, or ask an administrator to check Data quality → Gate → log.',
      (v_gate->>'errors')::integer
      using errcode = 'check_violation';
  end if;

  if v_enforce and coalesce((v_gate->>'blocked')::boolean, false) then
    select string_agg((i->>'rule_code') || ' — ' || (i->>'message'), '; ')
      into v_why
      from jsonb_array_elements(coalesce(v_gate->'issues', '[]'::jsonb)) i
     where i->>'mode' = 'block';
    raise exception 'DQ_GATE: %', coalesce(v_why, 'refused by the data-quality gate')
      using errcode = 'check_violation',
            hint = 'Rule modes per channel are set in Admin → Data quality → Gate.';
  end if;
  return new;
end $function$;

revoke all on function public.fn_dq_forms_gate() from public;

drop trigger if exists trg_cl_zz_dq_gate on public.cargo_listings;
create trigger trg_cl_zz_dq_gate
  before insert or update on public.cargo_listings
  for each row execute function public.fn_dq_forms_gate();

drop trigger if exists trg_va_zz_dq_gate on public.vessel_availability;
create trigger trg_va_zz_dq_gate
  before insert or update on public.vessel_availability
  for each row execute function public.fn_dq_forms_gate();

drop trigger if exists trg_vessels_zz_dq_gate on public.vessels;
create trigger trg_vessels_zz_dq_gate
  before insert or update on public.vessels
  for each row execute function public.fn_dq_forms_gate();

comment on function public.fn_dq_forms_gate() is
  'Member-form channel of the DQ gate: evaluates fn_dq_validate on every authenticated write (channel from the dq.channel setting, else forms). Shadow unless dq_settings.gate_forms_enforce; fails closed when enforcing.';

-- ── 4 · DQ-C05 now describes the gate, not a wish ───────────────────────────
update public.dq_rules
   set description = 'A cargo the members can see must resolve to a port on each side — its own LOCODE, or the reference port of the area it names. Since 17 Sep 2026 the database refuses a cargo becoming live without both (trg_cl_zy_live_route_gate); this rule reports any row that predates the gate.',
       updated_at = now()
 where code = 'DQ-C05';

-- ── 5 · what the gate would have refused today ──────────────────────────────
do $$
declare n int; v_refs text;
begin
  select count(*), string_agg(ref, ', ' order by ref)
    into n, v_refs
    from public.cargo_listings
   where status in ('IN', 'PARTIAL') and review_status = 'APPROVED'
     and (public.fn_cl_effective_locode(load_port_locode,  load_ref_locode,  load_port_2_locode)  is null
       or public.fn_cl_effective_locode(disch_port_locode, disch_ref_locode, disch_port_2_locode) is null);
  raise notice 'cargo_live_route_gate: % live approved cargo predate the gate and are not routable: %', n, coalesce(v_refs, '—');
end $$;
