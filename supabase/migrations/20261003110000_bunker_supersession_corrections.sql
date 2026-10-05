-- Fuel Bar: corrections from Opus's cross-audit O2B-010 of 109000.
--
--  P1  "Live" means approved, started and not yet superseded:
--        approved and valid_from <= now() and (superseded_at is null or superseded_at > now()).
--      A live quote whose replacement is scheduled can be withdrawn (supplier or
--      admin), and the portal and the admin console list both the live quote and
--      the scheduled one (liveNow tells them apart).
--  P2-3 A scheduled supersession can be moved or cleared until it takes effect,
--      but never into the past (no backdating of history).
--  P2-4 Approving a quote ends every quote on the same key that would otherwise
--      stay live after the new one takes effect (the whole chain, not only the
--      row with no supersession), in id order.
--  P2-5 Every supersession an approval sets is recorded with its previous value
--      in bunker_quote_supersessions; withdrawing that approval before it starts
--      restores exactly those rows (equal start times cannot collide).
--  P2-7 (accepted, documented) A historical as_of uses today's served ports.

create table if not exists public.bunker_quote_supersessions (
  approved_quote_id      uuid not null references public.bunker_quotes (id) on delete cascade,
  superseded_quote_id    uuid not null references public.bunker_quotes (id) on delete cascade,
  previous_superseded_at timestamptz,
  applied_superseded_at  timestamptz not null,
  created_at             timestamptz not null default now(),
  primary key (approved_quote_id, superseded_quote_id)
);
alter table public.bunker_quote_supersessions enable row level security;
revoke all on table public.bunker_quote_supersessions from public, anon, authenticated;

-- P2-3: no backdating.
create or replace function public.fn_bunker_quote_append_only()
returns trigger
language plpgsql set search_path to ''
as $$
declare
  v_state  text[] := array['status', 'decided_by', 'decided_at', 'decision_reason', 'superseded_at'];
begin
  if tg_op = 'DELETE' then
    raise exception 'BUNKER_IMMUTABLE: quotes are append-only' using errcode = '55000';
  end if;
  if (to_jsonb(new) - v_state) <> (to_jsonb(old) - v_state) then
    raise exception 'BUNKER_IMMUTABLE: quote content cannot change' using errcode = '55000';
  end if;
  if new.superseded_at is distinct from old.superseded_at then
    if old.superseded_at is not null and old.superseded_at <= now() then
      raise exception 'BUNKER_IMMUTABLE: a quote can only be superseded once' using errcode = '55000';
    end if;
    if new.superseded_at is not null and new.superseded_at < now() then
      raise exception 'BUNKER_IMMUTABLE: a supersession cannot be backdated' using errcode = '55000';
    end if;
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'submitted' and new.status in ('approved', 'rejected', 'withdrawn'))
    or (old.status = 'approved'  and new.status = 'withdrawn')) then
    raise exception 'BUNKER_STATUS: % -> % is not allowed', old.status, new.status using errcode = '55000';
  end if;
  if new.status = old.status and (new.decided_by, new.decided_at, new.decision_reason)
       is distinct from (old.decided_by, old.decided_at, old.decision_reason) then
    raise exception 'BUNKER_IMMUTABLE: a decision is recorded once' using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_bunker_quote_append_only() from public, anon, authenticated;

-- P2-4 + P2-5: approval ends the whole chain at the new start and records it.
create or replace function public.fn_bunker_approve_quote(p_quote_id uuid, p_actor uuid, p_reason text)
returns void
language plpgsql security definer set search_path to ''
as $$
declare
  q     public.bunker_quotes;
  prev  public.bunker_quotes;
  r     public.bunker_quotes;
  v_at  timestamptz;
begin
  select * into q from public.bunker_quotes where id = p_quote_id for update;
  if not found or q.status <> 'submitted' then
    raise exception 'BUNKER_STATUS: only a submitted quote can be approved' using errcode = '55000';
  end if;
  if q.valid_until < now() then
    raise exception 'BUNKER_VALIDITY: the quote''s validity has already lapsed' using errcode = '22023';
  end if;
  v_at := greatest(now(), q.valid_from);
  -- the price this one replaces, for the audit event (live now, else the scheduled one)
  select * into prev from public.bunker_quotes
   where supplier_id = q.supplier_id and port_locode = q.port_locode and product_key = q.product_key
     and status = 'approved' and valid_from <= now() and (superseded_at is null or superseded_at > now())
   order by submitted_at desc limit 1;
  if not found then
    select * into prev from public.bunker_quotes
     where supplier_id = q.supplier_id and port_locode = q.port_locode and product_key = q.product_key
       and status = 'approved' and superseded_at is null;
  end if;
  -- every quote on the key that would still be live after v_at ends at v_at
  for r in
    select * from public.bunker_quotes
     where supplier_id = q.supplier_id and port_locode = q.port_locode and product_key = q.product_key
       and status = 'approved' and id <> q.id
       and (superseded_at is null or superseded_at > v_at)
     order by id
     for update
  loop
    insert into public.bunker_quote_supersessions
      (approved_quote_id, superseded_quote_id, previous_superseded_at, applied_superseded_at)
    values (q.id, r.id, r.superseded_at, v_at);
    update public.bunker_quotes set superseded_at = v_at where id = r.id;
  end loop;
  update public.bunker_quotes
     set status = 'approved', decided_by = p_actor, decided_at = now(), decision_reason = p_reason
   where id = q.id;
  insert into public.bunker_quote_events
    (quote_id, supplier_id, port_locode, product_key, action, old_price, new_price, valid_until, actor, reason)
  values (q.id, q.supplier_id, q.port_locode, q.product_key, 'approve', prev.price, q.price, q.valid_until,
          p_actor, p_reason);
end;
$$;
revoke all on function public.fn_bunker_approve_quote(uuid, uuid, text) from public, anon, authenticated;

-- P2-5: restore exactly what the withdrawn (unstarted) approval superseded, if untouched since.
create or replace function public.fn_bunker_restore_on_unstarted_withdraw()
returns trigger
language plpgsql security definer set search_path to ''
as $$
begin
  if old.status = 'approved' and new.status = 'withdrawn' and new.valid_from > now() then
    update public.bunker_quotes p
       set superseded_at = s.previous_superseded_at
      from public.bunker_quote_supersessions s
     where s.approved_quote_id = new.id and p.id = s.superseded_quote_id
       and p.status = 'approved'
       and p.superseded_at = s.applied_superseded_at and p.superseded_at > now();
  end if;
  return null;
end;
$$;
revoke all on function public.fn_bunker_restore_on_unstarted_withdraw() from public, anon, authenticated;

-- P1: a live quote with a scheduled replacement can be withdrawn.
create or replace function public.supplier_withdraw_quote(p_quote_id uuid, p_reason text default null)
returns void
language plpgsql security definer set search_path to ''
as $$
declare
  v_actor uuid := public.fn_app_user_id();
  q       public.bunker_quotes;
begin
  select * into q from public.bunker_quotes where id = p_quote_id for update;
  if not found then
    raise exception 'BUNKER_AUTH: not a quote of yours' using errcode = '42501';
  end if;
  perform public.fn_bunker_member_supplier(q.supplier_id, true);
  if not (q.status = 'submitted'
          or (q.status = 'approved' and (q.superseded_at is null or q.superseded_at > now()))) then
    raise exception 'BUNKER_STATUS: only a pending, live or scheduled quote can be withdrawn' using errcode = '55000';
  end if;
  update public.bunker_quotes
     set status = 'withdrawn', decided_by = v_actor, decided_at = now(),
         decision_reason = coalesce(nullif(btrim(p_reason), ''), 'withdrawn by supplier'),
         -- a live price that is withdrawn stays the "previous price" for the ticker
         superseded_at = case when q.status = 'approved' then now() end
   where id = q.id;
  insert into public.bunker_quote_events
    (quote_id, supplier_id, port_locode, product_key, action, old_price, actor, reason)
  values (q.id, q.supplier_id, q.port_locode, q.product_key, 'withdraw', q.price, v_actor, p_reason);
end;
$$;
revoke all on function public.supplier_withdraw_quote(uuid, text) from public, anon;
grant execute on function public.supplier_withdraw_quote(uuid, text) to authenticated;

create or replace function public.admin_bunker_decide_quote(
  p_actor uuid, p_quote_id uuid, p_decision text, p_reason text default null
) returns void
language plpgsql security definer set search_path to ''
as $$
declare
  q public.bunker_quotes;
begin
  perform public.fn_bunker_assert_admin(p_actor, true);
  if p_decision = 'approve' then
    perform public.fn_bunker_approve_quote(p_quote_id, p_actor, nullif(btrim(coalesce(p_reason, '')), ''));
  elsif p_decision in ('reject', 'withdraw') then
    select * into q from public.bunker_quotes where id = p_quote_id for update;
    if not found or not (q.status = 'submitted'
                         or (p_decision = 'withdraw' and q.status = 'approved'
                             and (q.superseded_at is null or q.superseded_at > now()))) then
      raise exception 'BUNKER_STATUS: cannot % this quote', p_decision using errcode = '55000';
    end if;
    if length(btrim(coalesce(p_reason, ''))) < 3 then
      raise exception 'BUNKER_QUOTE: a reason is required' using errcode = '22023';
    end if;
    update public.bunker_quotes
       set status = case when p_decision = 'reject' then 'rejected' else 'withdrawn' end,
           decided_by = p_actor, decided_at = now(), decision_reason = btrim(p_reason),
           superseded_at = case when q.status = 'approved' then now() end
     where id = q.id;
    insert into public.bunker_quote_events
      (quote_id, supplier_id, port_locode, product_key, action, old_price, actor, reason)
    values (q.id, q.supplier_id, q.port_locode, q.product_key, p_decision, q.price, p_actor, btrim(p_reason));
  else
    raise exception 'BUNKER_STATUS: decision must be approve, reject or withdraw' using errcode = '22023';
  end if;
end;
$$;
revoke all on function public.admin_bunker_decide_quote(uuid, uuid, text, text) from public, anon, authenticated;

-- P1: the portal lists the live and the scheduled quote; liveNow tells them apart.
create or replace function public.supplier_list_my_quotes()
returns jsonb
language plpgsql stable security definer set search_path to ''
as $$
declare
  v_actor uuid := public.fn_app_user_id();
begin
  if v_actor is null or not exists (select 1 from public.users u where u.id = v_actor and u.is_active) then
    raise exception 'BUNKER_AUTH: sign in with an active account' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'products', (select coalesce(jsonb_agg(jsonb_build_object(
        'key', f.key, 'label', f.market_label, 'family', f.family, 'sulphurClass', f.sulphur_class,
        'isoGrade', f.iso_grade, 'coreSlot', f.core_slot, 'ecaSlot', f.eca_slot) order by f.sort_order), '[]'::jsonb)
      from public.fuel_products f where f.is_active),
    'suppliers', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'url', s.url, 'verified', s.verified, 'status', s.status,
        'role', m.role,
        'ports', (select coalesce(jsonb_agg(jsonb_build_object(
              'locode', sp.port_locode, 'name', coalesce(p.trade_name, sp.port_locode),
              'isPrimary', sp.is_primary,
              'eca', coalesce(fl.eca_zone is not null, false))
            order by sp.is_primary desc, p.trade_name), '[]'::jsonb)
            from public.bunker_supplier_ports sp
            join public.ports p on p.locode = sp.port_locode
            left join public.bunker_port_flags fl on fl.port_locode = sp.port_locode
           where sp.supplier_id = s.id),
        'quotes', (select coalesce(jsonb_agg(jsonb_build_object(
              'id', q.id, 'portLocode', q.port_locode, 'productKey', q.product_key,
              'priceUsdMt', q.price, 'deliveryMode', q.delivery_mode, 'minQtyMt', q.min_qty_mt,
              'bargeFeeUsd', q.barge_fee_usd, 'mandatoryChargesUsd', q.mandatory_charges_usd,
              'validFrom', q.valid_from, 'validUntil', q.valid_until, 'status', q.status,
              'source', q.source, 'submittedAt', q.submitted_at, 'decisionReason', q.decision_reason,
              'liveNow', q.status = 'approved' and q.valid_from <= now()
                         and (q.superseded_at is null or q.superseded_at > now()))
            order by q.port_locode, q.product_key, q.valid_from), '[]'::jsonb)
            from public.bunker_quotes q
           where q.supplier_id = s.id
             and (q.status = 'submitted'
                  or (q.status = 'approved' and (q.superseded_at is null or q.superseded_at > now())))),
        'history', (select coalesce(jsonb_agg(h.e order by h.created_at desc), '[]'::jsonb) from (
            select e.created_at, jsonb_build_object(
              'at', e.created_at, 'action', e.action, 'portLocode', e.port_locode,
              'productKey', e.product_key, 'oldPrice', e.old_price, 'newPrice', e.new_price,
              'validUntil', e.valid_until, 'byMe', e.actor = v_actor, 'reason', e.reason) as e
              from public.bunker_quote_events e
             where e.supplier_id = s.id
             order by e.created_at desc limit 100) h)
      ) order by s.name), '[]'::jsonb)
      from public.bunker_supplier_members m
      join public.bunker_suppliers s on s.id = m.supplier_id and not s.is_platform
     where m.user_id = v_actor)
  );
end;
$$;
revoke all on function public.supplier_list_my_quotes() from public, anon;
grant execute on function public.supplier_list_my_quotes() to authenticated;

-- P1: the console uses the same "live" and ages prices from when they take effect.
create or replace function public.admin_bunker_dashboard(p_actor uuid)
returns jsonb
language plpgsql stable security definer set search_path to ''
as $$
begin
  perform public.fn_bunker_assert_admin(p_actor, false);
  return jsonb_build_object(
    'asOf', now(),
    'suppliers', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'url', s.url, 'country', s.country, 'verified', s.verified,
        'status', s.status, 'trustScore', s.trust_score, 'isPlatform', s.is_platform, 'notes', s.notes,
        'contactName', s.contact_name, 'contactEmail', s.contact_email, 'contactPhone', s.contact_phone,
        'createdAt', s.created_at, 'updatedAt', s.updated_at,
        'ports', (select coalesce(jsonb_agg(jsonb_build_object(
              'locode', sp.port_locode, 'name', coalesce(p.trade_name, sp.port_locode), 'isPrimary', sp.is_primary)
            order by sp.is_primary desc, p.trade_name), '[]'::jsonb)
            from public.bunker_supplier_ports sp join public.ports p on p.locode = sp.port_locode
           where sp.supplier_id = s.id),
        'members', (select coalesce(jsonb_agg(jsonb_build_object(
              'userId', u.id, 'name', u.full_name, 'email', u.email, 'role', m.role, 'since', m.created_at)
            order by u.full_name), '[]'::jsonb)
            from public.bunker_supplier_members m join public.users u on u.id = m.user_id
           where m.supplier_id = s.id),
        'latestQuoteAt', (select max(greatest(q.submitted_at, q.valid_from)) from public.bunker_quotes q
                           where q.supplier_id = s.id and q.status = 'approved'
                             and (q.superseded_at is null or q.superseded_at > now())
                             and q.valid_from <= now() and q.valid_until >= now())
      ) order by s.is_platform, s.name), '[]'::jsonb)
      from public.bunker_suppliers s),
    'quotes', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', q.id, 'supplierId', q.supplier_id, 'supplierName', s.name, 'portLocode', q.port_locode,
        'portName', coalesce(p.trade_name, q.port_locode), 'productKey', q.product_key,
        'priceUsdMt', q.price, 'deliveryMode', q.delivery_mode, 'minQtyMt', q.min_qty_mt,
        'bargeFeeUsd', q.barge_fee_usd, 'mandatoryChargesUsd', q.mandatory_charges_usd,
        'validFrom', q.valid_from, 'validUntil', q.valid_until, 'status', q.status, 'source', q.source,
        'reason', q.reason, 'submittedAt', q.submitted_at,
        'freshness', public.fn_bunker_freshness(now() - greatest(q.submitted_at, q.valid_from)),
        'validNow', q.valid_from <= now() and q.valid_until >= now(),
        'liveNow', q.status = 'approved' and q.valid_from <= now()
                   and (q.superseded_at is null or q.superseded_at > now()))
      order by q.status desc, s.name, q.port_locode, q.product_key, q.valid_from), '[]'::jsonb)
      from public.bunker_quotes q
      join public.bunker_suppliers s on s.id = q.supplier_id
      join public.ports p on p.locode = q.port_locode
     where q.status = 'submitted'
        or (q.status = 'approved' and (q.superseded_at is null or q.superseded_at > now()))),
    'events', (select coalesce(jsonb_agg(h.e order by h.created_at desc), '[]'::jsonb) from (
        select e.created_at, jsonb_build_object(
          'at', e.created_at, 'supplierName', s.name, 'action', e.action, 'portLocode', e.port_locode,
          'productKey', e.product_key, 'oldPrice', e.old_price, 'newPrice', e.new_price,
          'validUntil', e.valid_until, 'actorName', u.full_name, 'reason', e.reason) as e
          from public.bunker_quote_events e
          join public.bunker_suppliers s on s.id = e.supplier_id
          left join public.users u on u.id = e.actor
         order by e.created_at desc limit 200) h),
    'alerts', (select coalesce(jsonb_agg(a.x order by a.sev, a.name), '[]'::jsonb) from (
        -- enabled suppliers whose newest live quote is no longer current, or who have none
        select case when l.latest is null or now() - l.latest > interval '14 days' then 1 else 2 end as sev,
               s.name,
               jsonb_build_object(
                 'kind', case when l.latest is null then 'no_live_quote'
                              when now() - l.latest > interval '14 days' then 'expired' else 'stale' end,
                 'supplierId', s.id, 'supplierName', s.name, 'latestQuoteAt', l.latest) as x
          from public.bunker_suppliers s
          left join lateral (select max(greatest(q.submitted_at, q.valid_from)) as latest from public.bunker_quotes q
                              where q.supplier_id = s.id and q.status = 'approved'
                                and (q.superseded_at is null or q.superseded_at > now())
                                and q.valid_from <= now() and q.valid_until >= now()) l on true
         where s.status = 'enabled' and not s.is_platform
           and (l.latest is null or now() - l.latest > interval '7 days')
        union all
        select 0, '', jsonb_build_object('kind', 'pending_approval', 'count', count(*))
          from public.bunker_quotes q where q.status = 'submitted'
        having count(*) > 0) a)
  );
end;
$$;
revoke all on function public.admin_bunker_dashboard(uuid) from public, anon, authenticated;
