-- Fuel Bar corrections from Codex's re-audit C2B-003 (4 Oct 2026). Additive.
--
--  1. Supplier submissions must carry a clientRef (unique within the batch):
--     a keyless retry can no longer create a second quote.
--  2. (UI) the portal resends the byte-identical command on a retry.
--  3. Rows keyed before 105000 (no command_sha256) replay by comparing every
--     stored term instead of the hash.
--  4. The 500-per-day limit counts only keys not seen before, so a legitimate
--     replay at the boundary succeeds.
--  5. supplier_upsert_quotes locks the supplier row and then re-checks that it
--     is enabled and that the caller is still its editor: a disable or a
--     membership removal committed during the wait wins.
--  6. Withdrawing a live quote sets superseded_at, so it remains the previous
--     price for the ticker's direction; earlier live withdrawals are backfilled.

create or replace function public.fn_bunker_record_quote(
  p_supplier_id uuid, p_item jsonb, p_source text, p_actor uuid, p_auto_approve boolean, p_reason text
) returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare
  v_port   text := upper(btrim(coalesce(p_item ->> 'portLocode', '')));
  v_prod   text := btrim(coalesce(p_item ->> 'productKey', ''));
  v_ref    text := nullif(btrim(coalesce(p_item ->> 'clientRef', '')), '');
  v_price  numeric;
  v_minq   numeric;
  v_barge  numeric;
  v_mand   numeric;
  v_mode   text := coalesce(nullif(p_item ->> 'deliveryMode', ''), 'barge');
  v_from   timestamptz;
  v_until  timestamptz;
  v_hash   text;
  v_old    public.bunker_quotes;
  v_id     uuid;
  v_status text;
begin
  begin
    v_price := (p_item ->> 'priceUsdMt')::numeric;
    v_minq  := nullif(p_item ->> 'minQtyMt', '')::numeric;
    v_barge := coalesce(nullif(p_item ->> 'bargeFeeUsd', '')::numeric, 0);
    v_mand  := coalesce(nullif(p_item ->> 'mandatoryChargesUsd', '')::numeric, 0);
    v_from  := coalesce(nullif(p_item ->> 'validFrom', '')::timestamptz, now());
    v_until := (p_item ->> 'validUntil')::timestamptz;
    v_hash  := public.fn_bunker_command_sha256(p_item);
  exception when others then
    raise exception 'BUNKER_QUOTE: malformed number or date' using errcode = '22023';
  end;

  -- Idempotency first: one transaction at a time per supplier + reference, so
  -- a concurrent first use waits and then replays instead of colliding.
  if v_ref is not null then
    if length(v_ref) > 80 then
      raise exception 'BUNKER_QUOTE: clientRef is longer than 80 characters' using errcode = '22023';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(p_supplier_id::text || '|' || v_ref, 7201));
    select * into v_old from public.bunker_quotes where supplier_id = p_supplier_id and client_ref = v_ref;
    if found then
      -- Rows keyed before 105000 carry no hash: compare every stored term
      -- instead (validFrom only when the replay states it, because the
      -- original may have defaulted it to the submission time).
      if v_old.command_sha256 = v_hash
         or (v_old.command_sha256 is null
             and v_old.port_locode = v_port and v_old.product_key = v_prod
             and v_old.price = round(v_price, 2) and v_old.delivery_mode = v_mode
             and v_old.min_qty_mt is not distinct from round(v_minq, 2)
             and v_old.barge_fee_usd = round(v_barge, 2)
             and v_old.mandatory_charges_usd = round(v_mand, 2)
             and v_old.valid_until = v_until
             and (nullif(p_item ->> 'validFrom', '') is null or v_old.valid_from = v_from)) then
        return jsonb_build_object('quoteId', v_old.id, 'status', v_old.status, 'duplicate', true);
      end if;
      raise exception 'BUNKER_QUOTE: clientRef % was already used for a different quote', v_ref
        using errcode = '23505';
    end if;
  end if;

  if not exists (select 1 from public.fuel_products f where f.key = v_prod and f.is_active) then
    raise exception 'BUNKER_QUOTE: unknown fuel product %', v_prod using errcode = '22023';
  end if;
  if not exists (select 1 from public.bunker_supplier_ports sp
                  where sp.supplier_id = p_supplier_id and sp.port_locode = v_port) then
    raise exception 'BUNKER_QUOTE: port % is not registered for this supplier', v_port using errcode = '22023';
  end if;
  if v_price is null or v_price <= 0 or v_price >= 10000 then
    raise exception 'BUNKER_QUOTE: price must be above zero and below 10000 USD/MT' using errcode = '22023';
  end if;
  if v_minq is not null and v_minq <= 0 then
    raise exception 'BUNKER_QUOTE: minimum quantity must be positive' using errcode = '22023';
  end if;
  if v_barge < 0 or v_mand < 0 then
    raise exception 'BUNKER_QUOTE: charges cannot be negative' using errcode = '22023';
  end if;
  if v_mode not in ('barge', 'truck', 'pipe', 'ex_wharf') then
    raise exception 'BUNKER_QUOTE: unknown delivery mode %', v_mode using errcode = '22023';
  end if;
  if v_until is null or v_until <= now() or v_until <= v_from
     or v_from < now() - interval '1 day' or v_from > now() + interval '7 days'
     or v_until > v_from + interval '60 days' then
    raise exception 'BUNKER_QUOTE: validity must start within a day, end in the future and last at most 60 days'
      using errcode = '22023';
  end if;

  -- A newer submission replaces the older pending one, on the record.
  with replaced as (
    update public.bunker_quotes
       set status = 'withdrawn', decided_by = p_actor, decided_at = now(),
           decision_reason = 'replaced by a newer submission'
     where supplier_id = p_supplier_id and port_locode = v_port and product_key = v_prod
       and status = 'submitted'
    returning id, supplier_id, port_locode, product_key, price
  )
  insert into public.bunker_quote_events
    (quote_id, supplier_id, port_locode, product_key, action, old_price, actor, reason)
  select id, supplier_id, port_locode, product_key, 'withdraw', price, p_actor, 'replaced by a newer submission'
    from replaced;

  insert into public.bunker_quotes
    (supplier_id, port_locode, product_key, price, delivery_mode, min_qty_mt, barge_fee_usd,
     mandatory_charges_usd, valid_from, valid_until, source, status, client_ref, command_sha256,
     reason, submitted_by)
  values
    (p_supplier_id, v_port, v_prod, v_price, v_mode, v_minq, v_barge,
     v_mand, v_from, v_until, p_source, 'submitted', v_ref, v_hash, p_reason, p_actor)
  returning id into v_id;

  insert into public.bunker_quote_events
    (quote_id, supplier_id, port_locode, product_key, action, new_price, valid_until, actor, reason)
  values (v_id, p_supplier_id, v_port, v_prod,
          case when p_source = 'admin_override' then 'override' else 'submit' end,
          v_price, v_until, p_actor, p_reason);

  v_status := 'submitted';
  if p_auto_approve then
    perform public.fn_bunker_approve_quote(v_id, p_actor,
      case when p_source = 'supplier' then 'verified supplier: auto-approved' else p_reason end);
    v_status := 'approved';
  end if;
  return jsonb_build_object('quoteId', v_id, 'status', v_status, 'duplicate', false);
end;
$$;
revoke all on function public.fn_bunker_record_quote(uuid, jsonb, text, uuid, boolean, text)
  from public, anon, authenticated;

create or replace function public.supplier_upsert_quotes(p_quotes jsonb, p_supplier_id uuid default null)
returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare
  v_actor    uuid := public.fn_app_user_id();
  v_supplier uuid := public.fn_bunker_member_supplier(p_supplier_id, true);
  v_verified boolean;
  v_results  jsonb := '[]'::jsonb;
  v_item     jsonb;
  v_i        int := 0;
  v_new      int;
begin
  if jsonb_typeof(p_quotes) is distinct from 'array' or jsonb_array_length(p_quotes) = 0 then
    raise exception 'BUNKER_QUOTE: send a non-empty array of quotes' using errcode = '22023';
  end if;
  if jsonb_array_length(p_quotes) > 100 then
    raise exception 'BUNKER_QUOTE: at most 100 quotes per submission' using errcode = '22023';
  end if;

  -- Every supplier submission carries its own idempotency key: a keyless
  -- retry could not be told apart from a new quote.
  if exists (select 1 from jsonb_array_elements(p_quotes) x
              where length(btrim(coalesce(x ->> 'clientRef', ''))) = 0) then
    raise exception 'BUNKER_QUOTE: every quote needs a clientRef (idempotency key)' using errcode = '22023';
  end if;
  if (select count(distinct btrim(x ->> 'clientRef')) from jsonb_array_elements(p_quotes) x)
     <> jsonb_array_length(p_quotes) then
    raise exception 'BUNKER_QUOTE: clientRef must be unique within a submission' using errcode = '22023';
  end if;

  -- Lock the supplier, then re-check what the lock protects: a disable or a
  -- membership change committed while we waited wins.
  select s.verified into v_verified from public.bunker_suppliers s
   where s.id = v_supplier and s.status = 'enabled' and not s.is_platform
   for update;
  if not found or not exists (
       select 1 from public.bunker_supplier_members m
        where m.supplier_id = v_supplier and m.user_id = v_actor and m.role = 'editor') then
    raise exception 'BUNKER_AUTH: this supplier is not open to you for submissions' using errcode = '42501';
  end if;

  -- Replays of an existing clientRef are free; only new keys count.
  select count(*) into v_new from jsonb_array_elements(p_quotes) x
   where not exists (select 1 from public.bunker_quotes q
                      where q.supplier_id = v_supplier and q.client_ref = btrim(x ->> 'clientRef'));
  if v_new > 0 and (select count(*) from public.bunker_quote_events e
       where e.supplier_id = v_supplier and e.action = 'submit'
         and e.created_at > now() - interval '24 hours') + v_new > 500 then
    raise exception 'BUNKER_RATE: daily submission limit reached; try again tomorrow' using errcode = '54000';
  end if;

  for v_item in select value from jsonb_array_elements(p_quotes) loop
    begin
      v_results := v_results || jsonb_build_array(
        jsonb_build_object('index', v_i) ||
        public.fn_bunker_record_quote(v_supplier, v_item, 'supplier', v_actor, v_verified, null));
    exception when sqlstate '22023' or sqlstate '23505' then
      raise exception 'item %: %', v_i, sqlerrm using errcode = sqlstate;
    end;
    v_i := v_i + 1;
  end loop;

  return jsonb_build_object('supplierId', v_supplier, 'autoApproved', v_verified, 'results', v_results);
end;
$$;
revoke all on function public.supplier_upsert_quotes(jsonb, uuid) from public, anon;
grant execute on function public.supplier_upsert_quotes(jsonb, uuid) to authenticated;

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
  if not (q.status = 'submitted' or (q.status = 'approved' and q.superseded_at is null)) then
    raise exception 'BUNKER_STATUS: only a pending or live quote can be withdrawn' using errcode = '55000';
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
                         or (p_decision = 'withdraw' and q.status = 'approved' and q.superseded_at is null)) then
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
revoke all on function public.admin_bunker_decide_quote(uuid, uuid, text, text) from public, anon, authenticated;

-- 6 · backfill: withdrawn quotes that had been live (an approve event exists).
update public.bunker_quotes q
   set superseded_at = q.decided_at
 where q.status = 'withdrawn' and q.superseded_at is null and q.decided_at is not null
   and exists (select 1 from public.bunker_quote_events e where e.quote_id = q.id and e.action = 'approve');
