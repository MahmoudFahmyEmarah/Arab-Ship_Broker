-- Fuel Bar commands (plan r2 §3.2 + r2.1 §3).
--
-- Supplier commands are called by signed-in members (granted to
-- authenticated); the actor is always fn_app_user_id(), never a parameter.
-- A member may act only for a supplier they belong to (editor role to write),
-- only at that supplier's registered ports, and can never approve a quote or
-- change a supplier, its ports or its members: there is no RPC for that.
-- Quotes from a verified supplier are approved on submission; otherwise they
-- wait for an admin decision.
--
-- Admin commands are service-role only and called after requireAdmin() in
-- server actions; they re-check p_actor against public.users (active admin,
-- super tier or the 'bunker' section permission), as the PDA module does.

-- ── Actors ──────────────────────────────────────────────────────────────────

create or replace function public.fn_bunker_assert_admin(p_actor uuid, p_edit boolean)
returns void
language plpgsql stable security definer set search_path to ''
as $$
begin
  if p_actor is null or not exists (
    select 1 from public.users u
     where u.id = p_actor and u.is_active and lower(coalesce(u.role, '')) = 'admin'
       and (coalesce(u.admin_tier, 'super') = 'super'
            or u.admin_perms ->> 'bunker' = 'edit'
            or (not p_edit and u.admin_perms ->> 'bunker' = 'view'))
  ) then
    raise exception 'BUNKER_AUTH: admin with bunker % access required',
      case when p_edit then 'edit' else 'view' end using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.fn_bunker_assert_admin(uuid, boolean) from public, anon, authenticated;

-- Resolves the supplier a member acts for. p_supplier_id may be null when the
-- member belongs to exactly one supplier.
create or replace function public.fn_bunker_member_supplier(p_supplier_id uuid, p_need_editor boolean)
returns uuid
language plpgsql stable security definer set search_path to ''
as $$
declare
  v_actor uuid := public.fn_app_user_id();
  v_ids   uuid[];
begin
  if v_actor is null or not exists (select 1 from public.users u where u.id = v_actor and u.is_active) then
    raise exception 'BUNKER_AUTH: sign in with an active account' using errcode = '42501';
  end if;
  select array_agg(m.supplier_id) into v_ids
    from public.bunker_supplier_members m
    join public.bunker_suppliers s on s.id = m.supplier_id and s.status = 'enabled' and not s.is_platform
   where m.user_id = v_actor
     and (p_supplier_id is null or m.supplier_id = p_supplier_id)
     and (not p_need_editor or m.role = 'editor');
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception 'BUNKER_AUTH: not a % of this bunker supplier',
      case when p_need_editor then 'editor' else 'member' end using errcode = '42501';
  end if;
  if array_length(v_ids, 1) > 1 then
    raise exception 'BUNKER_SUPPLIER: you belong to several suppliers; choose one' using errcode = '22023';
  end if;
  return v_ids[1];
end;
$$;
revoke all on function public.fn_bunker_member_supplier(uuid, boolean) from public, anon, authenticated;

-- ── Quote lifecycle (internal) ──────────────────────────────────────────────

create or replace function public.fn_bunker_approve_quote(p_quote_id uuid, p_actor uuid, p_reason text)
returns void
language plpgsql security definer set search_path to ''
as $$
declare
  q    public.bunker_quotes;
  prev public.bunker_quotes;
begin
  select * into q from public.bunker_quotes where id = p_quote_id for update;
  if not found or q.status <> 'submitted' then
    raise exception 'BUNKER_STATUS: only a submitted quote can be approved' using errcode = '55000';
  end if;
  select * into prev from public.bunker_quotes
   where supplier_id = q.supplier_id and port_locode = q.port_locode and product_key = q.product_key
     and status = 'approved' and superseded_at is null
   for update;
  if found then
    update public.bunker_quotes set superseded_at = now() where id = prev.id;
  end if;
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

-- Validates one quote item and records it as submitted (withdrawing an older
-- pending quote for the same slot). Idempotent on client_ref: replaying the
-- same item returns the existing quote; reusing a client_ref for different
-- content is refused. Returns {quoteId, status, duplicate}.
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
  exception when others then
    raise exception 'BUNKER_QUOTE: malformed number or date' using errcode = '22023';
  end;

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

  if v_ref is not null then
    select * into v_old from public.bunker_quotes where supplier_id = p_supplier_id and client_ref = v_ref;
    if found then
      if v_old.port_locode = v_port and v_old.product_key = v_prod and v_old.price = v_price
         and v_old.valid_until = v_until then
        return jsonb_build_object('quoteId', v_old.id, 'status', v_old.status, 'duplicate', true);
      end if;
      raise exception 'BUNKER_QUOTE: clientRef % was already used for a different quote', v_ref
        using errcode = '23505';
    end if;
  end if;

  update public.bunker_quotes
     set status = 'withdrawn', decided_by = p_actor, decided_at = now(),
         decision_reason = 'replaced by a newer submission'
   where supplier_id = p_supplier_id and port_locode = v_port and product_key = v_prod
     and status = 'submitted';

  insert into public.bunker_quotes
    (supplier_id, port_locode, product_key, price, delivery_mode, min_qty_mt, barge_fee_usd,
     mandatory_charges_usd, valid_from, valid_until, source, status, client_ref, reason, submitted_by)
  values
    (p_supplier_id, v_port, v_prod, v_price, v_mode, v_minq, v_barge,
     v_mand, v_from, v_until, p_source, 'submitted', v_ref, p_reason, p_actor)
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

-- ── Supplier (member) commands ──────────────────────────────────────────────

-- Submits up to 100 quotes atomically (one bad item rejects the whole batch).
-- Item: {portLocode, productKey, priceUsdMt, validUntil, validFrom?, deliveryMode?,
--        minQtyMt?, bargeFeeUsd?, mandatoryChargesUsd?, clientRef?}
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
begin
  if jsonb_typeof(p_quotes) <> 'array' or jsonb_array_length(p_quotes) = 0 then
    raise exception 'BUNKER_QUOTE: send a non-empty array of quotes' using errcode = '22023';
  end if;
  if jsonb_array_length(p_quotes) > 100 then
    raise exception 'BUNKER_QUOTE: at most 100 quotes per submission' using errcode = '22023';
  end if;
  if (select count(*) from public.bunker_quote_events e
       where e.supplier_id = v_supplier and e.action = 'submit'
         and e.created_at > now() - interval '24 hours') + jsonb_array_length(p_quotes) > 500 then
    raise exception 'BUNKER_RATE: daily submission limit reached; try again tomorrow' using errcode = '54000';
  end if;

  select s.verified into v_verified from public.bunker_suppliers s where s.id = v_supplier for update;

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
         decision_reason = coalesce(nullif(btrim(p_reason), ''), 'withdrawn by supplier')
   where id = q.id;
  insert into public.bunker_quote_events
    (quote_id, supplier_id, port_locode, product_key, action, old_price, actor, reason)
  values (q.id, q.supplier_id, q.port_locode, q.product_key, 'withdraw', q.price, v_actor, p_reason);
end;
$$;
revoke all on function public.supplier_withdraw_quote(uuid, text) from public, anon;
grant execute on function public.supplier_withdraw_quote(uuid, text) to authenticated;

-- The supplier portal's whole state for the suppliers the caller belongs to.
-- Their own quote ids are returned (they own them); other members are not
-- named, and no contact details are returned.
create or replace function public.supplier_list_my_quotes()
returns jsonb
language plpgsql stable security definer set search_path to ''
as $$
declare
  v_actor uuid := public.fn_app_user_id();
begin
  if v_actor is null then
    raise exception 'BUNKER_AUTH: sign in first' using errcode = '42501';
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
              'source', q.source, 'submittedAt', q.submitted_at, 'decisionReason', q.decision_reason)
            order by q.port_locode, q.product_key), '[]'::jsonb)
            from public.bunker_quotes q
           where q.supplier_id = s.id
             and (q.status = 'submitted' or (q.status = 'approved' and q.superseded_at is null))),
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

-- ── Admin commands (service role + p_actor) ─────────────────────────────────

-- Creates or updates a supplier and replaces its port set.
-- {id?, name, url?, country?, verified?, status?, trustScore?, notes?,
--  contactName?, contactEmail?, contactPhone?, ports: [{locode, isPrimary?}]}
create or replace function public.admin_bunker_upsert_supplier(p_actor uuid, p_supplier jsonb)
returns uuid
language plpgsql security definer set search_path to ''
as $$
declare
  v_id    uuid := nullif(p_supplier ->> 'id', '')::uuid;
  v_ports jsonb := coalesce(p_supplier -> 'ports', '[]'::jsonb);
  v_bad   text;
begin
  perform public.fn_bunker_assert_admin(p_actor, true);
  if jsonb_typeof(v_ports) <> 'array' then
    raise exception 'BUNKER_SUPPLIER: ports must be an array' using errcode = '22023';
  end if;
  select upper(x ->> 'locode') into v_bad from jsonb_array_elements(v_ports) x
   where not exists (select 1 from public.ports p where p.locode = upper(x ->> 'locode')) limit 1;
  if v_bad is not null then
    raise exception 'BUNKER_SUPPLIER: unknown port %', v_bad using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(v_ports) x where (x ->> 'isPrimary')::boolean) > 1 then
    raise exception 'BUNKER_SUPPLIER: one primary port at most' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.bunker_suppliers
      (name, url, country, verified, status, trust_score, notes, contact_name, contact_email, contact_phone,
       created_by, updated_by)
    values (btrim(p_supplier ->> 'name'), nullif(p_supplier ->> 'url', ''), nullif(p_supplier ->> 'country', ''),
            coalesce((p_supplier ->> 'verified')::boolean, false),
            coalesce(nullif(p_supplier ->> 'status', ''), 'enabled'),
            coalesce((p_supplier ->> 'trustScore')::smallint, 50),
            nullif(p_supplier ->> 'notes', ''), nullif(p_supplier ->> 'contactName', ''),
            nullif(p_supplier ->> 'contactEmail', ''), nullif(p_supplier ->> 'contactPhone', ''),
            p_actor, p_actor)
    returning id into v_id;
  else
    update public.bunker_suppliers set
      name = btrim(p_supplier ->> 'name'),
      url = nullif(p_supplier ->> 'url', ''),
      country = nullif(p_supplier ->> 'country', ''),
      verified = coalesce((p_supplier ->> 'verified')::boolean, verified),
      status = coalesce(nullif(p_supplier ->> 'status', ''), status),
      trust_score = coalesce((p_supplier ->> 'trustScore')::smallint, trust_score),
      notes = nullif(p_supplier ->> 'notes', ''),
      contact_name = nullif(p_supplier ->> 'contactName', ''),
      contact_email = nullif(p_supplier ->> 'contactEmail', ''),
      contact_phone = nullif(p_supplier ->> 'contactPhone', ''),
      updated_by = p_actor, updated_at = now()
    where id = v_id and not is_platform;
    if not found then
      raise exception 'BUNKER_SUPPLIER: no such supplier' using errcode = '22023';
    end if;
  end if;

  delete from public.bunker_supplier_ports sp
   where sp.supplier_id = v_id
     and not exists (select 1 from jsonb_array_elements(v_ports) x where upper(x ->> 'locode') = sp.port_locode);
  insert into public.bunker_supplier_ports (supplier_id, port_locode, is_primary)
  select v_id, upper(x ->> 'locode'), false from jsonb_array_elements(v_ports) x
  on conflict (supplier_id, port_locode) do update set is_primary = false;
  update public.bunker_supplier_ports sp set is_primary = true
   where sp.supplier_id = v_id
     and sp.port_locode in (select upper(x ->> 'locode') from jsonb_array_elements(v_ports) x
                             where (x ->> 'isPrimary')::boolean);
  return v_id;
end;
$$;
revoke all on function public.admin_bunker_upsert_supplier(uuid, jsonb) from public, anon, authenticated;

-- Links a member account to a supplier (role editor|viewer) or unlinks it (null).
create or replace function public.admin_bunker_set_member(
  p_actor uuid, p_supplier_id uuid, p_user_id uuid, p_role text
) returns void
language plpgsql security definer set search_path to ''
as $$
begin
  perform public.fn_bunker_assert_admin(p_actor, true);
  if p_role is null then
    delete from public.bunker_supplier_members where supplier_id = p_supplier_id and user_id = p_user_id;
    return;
  end if;
  if p_role not in ('editor', 'viewer') then
    raise exception 'BUNKER_MEMBER: role must be editor or viewer' using errcode = '22023';
  end if;
  if not exists (select 1 from public.bunker_suppliers where id = p_supplier_id and not is_platform) then
    raise exception 'BUNKER_MEMBER: no such supplier' using errcode = '22023';
  end if;
  if not exists (select 1 from public.users where id = p_user_id and is_active) then
    raise exception 'BUNKER_MEMBER: no such active account' using errcode = '22023';
  end if;
  insert into public.bunker_supplier_members (supplier_id, user_id, role, invited_by)
  values (p_supplier_id, p_user_id, p_role, p_actor)
  on conflict (supplier_id, user_id) do update set role = excluded.role;
end;
$$;
revoke all on function public.admin_bunker_set_member(uuid, uuid, uuid, text) from public, anon, authenticated;

-- Admin price entry: an override of a supplier's price (until it republishes)
-- or a manual input under the platform supplier. Approved immediately.
create or replace function public.admin_bunker_override_quote(
  p_actor uuid, p_supplier_id uuid, p_quote jsonb, p_reason text
) returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare
  v_platform boolean;
begin
  perform public.fn_bunker_assert_admin(p_actor, true);
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'BUNKER_QUOTE: a reason is required' using errcode = '22023';
  end if;
  select s.is_platform into v_platform from public.bunker_suppliers s where s.id = p_supplier_id for update;
  if not found then
    raise exception 'BUNKER_SUPPLIER: no such supplier' using errcode = '22023';
  end if;
  return public.fn_bunker_record_quote(p_supplier_id, p_quote,
    case when v_platform then 'admin_input' else 'admin_override' end, p_actor, true, btrim(p_reason));
end;
$$;
revoke all on function public.admin_bunker_override_quote(uuid, uuid, jsonb, text) from public, anon, authenticated;

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
           decided_by = p_actor, decided_at = now(), decision_reason = btrim(p_reason)
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

-- Everything the admin Bunker page shows, in one read: suppliers (with
-- contacts, ports, members), live and pending quotes, recent history and
-- freshness alerts.
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
        'latestQuoteAt', (select max(q.submitted_at) from public.bunker_quotes q
                           where q.supplier_id = s.id and q.status = 'approved' and q.superseded_at is null)
      ) order by s.is_platform, s.name), '[]'::jsonb)
      from public.bunker_suppliers s),
    'quotes', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', q.id, 'supplierId', q.supplier_id, 'supplierName', s.name, 'portLocode', q.port_locode,
        'portName', coalesce(p.trade_name, q.port_locode), 'productKey', q.product_key,
        'priceUsdMt', q.price, 'deliveryMode', q.delivery_mode, 'minQtyMt', q.min_qty_mt,
        'bargeFeeUsd', q.barge_fee_usd, 'mandatoryChargesUsd', q.mandatory_charges_usd,
        'validFrom', q.valid_from, 'validUntil', q.valid_until, 'status', q.status, 'source', q.source,
        'reason', q.reason, 'submittedAt', q.submitted_at,
        'freshness', public.fn_bunker_freshness(now() - q.submitted_at),
        'validNow', q.valid_from <= now() and q.valid_until >= now())
      order by q.status desc, s.name, q.port_locode, q.product_key), '[]'::jsonb)
      from public.bunker_quotes q
      join public.bunker_suppliers s on s.id = q.supplier_id
      join public.ports p on p.locode = q.port_locode
     where q.status = 'submitted' or (q.status = 'approved' and q.superseded_at is null)),
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
          left join lateral (select max(q.submitted_at) as latest from public.bunker_quotes q
                              where q.supplier_id = s.id and q.status = 'approved'
                                and q.superseded_at is null) l on true
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
