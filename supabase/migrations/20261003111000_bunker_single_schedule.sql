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
