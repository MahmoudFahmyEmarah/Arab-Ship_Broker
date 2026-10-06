-- Fuel Bar: at most one scheduled replacement per supplier x port x product
-- (Codex audit C2B-011 #2, option "enforce a single-future-row invariant").
--
-- Approving a quote first withdraws any other approved quote on the same key that
-- has not started yet ("replaced by a newer scheduled price"). The 110000 restore
-- trigger then gives back what that unstarted quote had superseded, and the chain
-- step below supersedes the live price again at the new start, recording it in the
-- ledger. So a key is always: one live price, plus at most one scheduled price, and
-- cancelling the scheduled price brings the live price back. The supplier portal
-- and the console therefore show exactly the rows that will take effect.

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

  -- single-future-row invariant: an older unstarted price on the key is replaced
  for r in
    select * from public.bunker_quotes
     where supplier_id = q.supplier_id and port_locode = q.port_locode and product_key = q.product_key
       and status = 'approved' and id <> q.id and valid_from > now()
       and (superseded_at is null or superseded_at > now())
     order by id
     for update
  loop
    update public.bunker_quotes
       set status = 'withdrawn', decided_by = p_actor, decided_at = now(),
           decision_reason = 'replaced by a newer scheduled price', superseded_at = now()
     where id = r.id;
    insert into public.bunker_quote_events
      (quote_id, supplier_id, port_locode, product_key, action, old_price, actor, reason)
    values (r.id, r.supplier_id, r.port_locode, r.product_key, 'withdraw', r.price, p_actor,
            'replaced by a newer scheduled price');
  end loop;

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

-- C2B-012: bring chains scheduled under 110000 to the invariant at install time.
-- On every key with more than one unstarted approved price, the end of the chain
-- (the one no other row supersedes, i.e. the most recently approved) is kept and the older ones are withdrawn ("replaced by a newer
-- scheduled price"). With the kept price parked, the older schedules are closed
-- as of now and withdrawn (any order; the restore trigger returns the live price
-- to its pre-chain value), then the live price ends at the kept start with that
-- settled value recorded as the kept price's "previous", so cancelling the kept
-- price later restores the true pre-chain state. Idempotent:
-- a database already at the invariant is left unchanged. Returns the number of
-- prices withdrawn.
create or replace function public.fn_bunker_normalise_schedules()
returns integer
language plpgsql security definer set search_path to ''
as $$
declare
  k      record;
  keep   public.bunker_quotes;
  r      public.bunker_quotes;
  v_drop uuid[];
  v_at   timestamptz;
  v_n    integer := 0;
begin
  for k in
    select supplier_id, port_locode, product_key
      from public.bunker_quotes
     where status = 'approved' and valid_from > now()
       and (superseded_at is null or superseded_at > now())
     group by supplier_id, port_locode, product_key
    having count(*) > 1
  loop
    select * into keep from public.bunker_quotes
     where supplier_id = k.supplier_id and port_locode = k.port_locode and product_key = k.product_key
       and status = 'approved' and valid_from > now() and (superseded_at is null or superseded_at > now())
     -- the end of the 110000 chain: the latest approval supersedes every row that would
     -- outlive its start, so the newest schedule is the one nothing supersedes; time
     -- only breaks ties (approvals in one transaction share now()).
     order by (superseded_at is null) desc, decided_at desc nulls last, valid_from desc, submitted_at desc, id desc
     limit 1;
    v_at := greatest(now(), keep.valid_from);

    -- The older unstarted prices to remove, fixed before anything changes.
    select coalesce(array_agg(q.id order by q.id), '{}') into v_drop
      from public.bunker_quotes q
     where q.supplier_id = k.supplier_id and q.port_locode = k.port_locode and q.product_key = k.product_key
       and q.status = 'approved' and q.valid_from > now()
       and (q.superseded_at is null or q.superseded_at > now()) and q.id <> keep.id;

    -- 1) Park the kept price as "ends at infinity" while the key is rewritten, so
    --    nothing the restore trigger reopens can collide with it (one_live).
    update public.bunker_quotes set superseded_at = 'infinity' where id = keep.id;

    -- 2) Close every older schedule as of now (they never start). A row closed at
    --    now() no longer matches the restore trigger, so withdrawing them in any
    --    order cannot reopen one of them (C2B-015).
    update public.bunker_quotes set superseded_at = now() where id = any (v_drop);

    -- 3) Withdraw them. The 110000 restore trigger now gives every surviving price
    --    (the live one) back its pre-chain value, e.g. open again (C2B-017).
    for r in select * from public.bunker_quotes where id = any (v_drop) order by id for update
    loop
      update public.bunker_quotes
         set status = 'withdrawn', decided_at = now(),
             decision_reason = 'replaced by a newer scheduled price'
       where id = r.id;
      insert into public.bunker_quote_events
        (quote_id, supplier_id, port_locode, product_key, action, old_price, reason)
      values (r.id, r.supplier_id, r.port_locode, r.product_key, 'withdraw', r.price,
              'replaced by a newer scheduled price (111000 normalisation)');
      v_n := v_n + 1;
    end loop;

    -- 4) Only now, with the chain settled, every other open price ends at the kept
    --    start, and the kept price's ledger records the settled value as "previous"
    --    (replacing any stale entry from 110000), so cancelling the kept price
    --    restores the true pre-chain state.
    for r in
      select * from public.bunker_quotes
       where supplier_id = keep.supplier_id and port_locode = keep.port_locode and product_key = keep.product_key
         and status = 'approved' and id <> keep.id and not (id = any (v_drop))
         and (superseded_at is null or superseded_at > now())
       order by id
       for update
    loop
      insert into public.bunker_quote_supersessions
        (approved_quote_id, superseded_quote_id, previous_superseded_at, applied_superseded_at)
      values (keep.id, r.id, r.superseded_at, v_at)
      on conflict (approved_quote_id, superseded_quote_id)
      do update set previous_superseded_at = excluded.previous_superseded_at,
                    applied_superseded_at  = excluded.applied_superseded_at;
      update public.bunker_quotes set superseded_at = v_at where id = r.id;
    end loop;

    -- 5) Un-park the kept price.
    update public.bunker_quotes set superseded_at = null where id = keep.id;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.fn_bunker_normalise_schedules() from public, anon, authenticated;

do $$
declare v integer;
begin
  v := public.fn_bunker_normalise_schedules();
  if v > 0 then raise notice 'bunker 111000: % older scheduled price(s) replaced to restore one schedule per key', v; end if;
  if exists (select 1 from public.bunker_quotes
              where status = 'approved' and valid_from > now() and (superseded_at is null or superseded_at > now())
              group by supplier_id, port_locode, product_key having count(*) > 1) then
    raise exception 'BUNKER_111000: more than one scheduled price remains on a key after normalisation' using errcode = '55000';
  end if;
end $$;
