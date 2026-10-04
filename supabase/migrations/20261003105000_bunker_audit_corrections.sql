-- Fuel Bar corrections from Codex's audit C2B-002 (4 Oct 2026). Additive:
-- a database that already applied 100000–104000 upgrades in place.
--
--  1. Ticker: a quote shows only while valid (valid_from <= now <= valid_until),
--     judged per product before freshness and direction; age tiers come from
--     the newest valid quote of the row.
--  2. Port flags: members lose direct SELECT (it exposed updated_by and notes);
--     they read only the compliance facts through get_bunker_port_flags().
--  3. client_ref: bound to a hash of the complete command and serialised per
--     supplier + reference, so a concurrent or repeated first use returns the
--     same quote and a reused reference with any different term is refused.
--     The supplier row is locked before the daily-limit count.
--  4. A pending quote replaced by a newer submission is audited ('withdraw').
--  5. supplier_list_my_quotes requires an active account.
--  6. Freshness alerts count only quotes valid now.
--  7. Staff price input under "Platform (manual)" registers the port itself.

-- ── 2 · port flags: facts only, through an RPC ──────────────────────────────
drop policy if exists bunker_port_flags_member_read on public.bunker_port_flags;
revoke all on public.bunker_port_flags from anon, authenticated;

create or replace function public.get_bunker_port_flags(p_locodes text[] default null)
returns jsonb
language sql stable security definer set search_path to ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'locode', f.port_locode, 'ecaZone', f.eca_zone,
           'euBerthRule', f.eu_berth_rule, 'openLoopBan', f.open_loop_ban)
         order by f.port_locode), '[]'::jsonb)
    from public.bunker_port_flags f
   where p_locodes is null or f.port_locode = any (p_locodes)
$$;
revoke all on function public.get_bunker_port_flags(text[]) from public, anon;
grant execute on function public.get_bunker_port_flags(text[]) to authenticated, service_role;

-- ── 3 · complete, serialised idempotency ────────────────────────────────────
alter table public.bunker_quotes add column if not exists command_sha256 text
  check (command_sha256 is null or command_sha256 ~ '^[0-9a-f]{64}$');

comment on column public.bunker_quotes.command_sha256 is
  'SHA-256 of the canonical submitted command (every term the submitter chose); a client_ref replays only with an identical hash.';

-- Canonical command: every submitted term, numbers at 2 dp, times in UTC,
-- omitted optional terms as null (so a replay that omits them again matches).
create or replace function public.fn_bunker_command_sha256(p_item jsonb)
returns text
language plpgsql stable set search_path to ''  -- timestamptz input depends on the session TimeZone
as $$
declare
  v_num  text[] := array['priceUsdMt', 'minQtyMt', 'bargeFeeUsd', 'mandatoryChargesUsd'];
  v_ts   text[] := array['validFrom', 'validUntil'];
  v_key  text;
  v_out  jsonb := jsonb_build_object(
    'portLocode', upper(btrim(coalesce(p_item ->> 'portLocode', ''))),
    'productKey', btrim(coalesce(p_item ->> 'productKey', '')),
    'deliveryMode', coalesce(nullif(p_item ->> 'deliveryMode', ''), 'barge'));
begin
  foreach v_key in array v_num loop
    v_out := v_out || jsonb_build_object(v_key,
      case when nullif(p_item ->> v_key, '') is null then null
           else to_char(round((p_item ->> v_key)::numeric, 2), 'FM9999999990.00') end);
  end loop;
  foreach v_key in array v_ts loop
    v_out := v_out || jsonb_build_object(v_key,
      case when nullif(p_item ->> v_key, '') is null then null
           else to_char((p_item ->> v_key)::timestamptz at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end);
  end loop;
  return encode(sha256(convert_to(v_out::text, 'UTF8')), 'hex');
end;
$$;
revoke all on function public.fn_bunker_command_sha256(jsonb) from public, anon, authenticated;

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
      if v_old.command_sha256 = v_hash then
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

-- Lock the supplier before counting today's submissions.
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
  if jsonb_typeof(p_quotes) is distinct from 'array' or jsonb_array_length(p_quotes) = 0 then
    raise exception 'BUNKER_QUOTE: send a non-empty array of quotes' using errcode = '22023';
  end if;
  if jsonb_array_length(p_quotes) > 100 then
    raise exception 'BUNKER_QUOTE: at most 100 quotes per submission' using errcode = '22023';
  end if;

  select s.verified into v_verified from public.bunker_suppliers s where s.id = v_supplier for update;

  if (select count(*) from public.bunker_quote_events e
       where e.supplier_id = v_supplier and e.action = 'submit'
         and e.created_at > now() - interval '24 hours') + jsonb_array_length(p_quotes) > 500 then
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

-- ── 5 · portal state needs an active account ────────────────────────────────
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

-- ── 7 · staff input registers the platform supplier's port ──────────────────
create or replace function public.admin_bunker_override_quote(
  p_actor uuid, p_supplier_id uuid, p_quote jsonb, p_reason text
) returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare
  v_platform boolean;
  v_port     text := upper(btrim(coalesce(p_quote ->> 'portLocode', '')));
begin
  perform public.fn_bunker_assert_admin(p_actor, true);
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'BUNKER_QUOTE: a reason is required' using errcode = '22023';
  end if;
  select s.is_platform into v_platform from public.bunker_suppliers s where s.id = p_supplier_id for update;
  if not found then
    raise exception 'BUNKER_SUPPLIER: no such supplier' using errcode = '22023';
  end if;
  if v_platform then
    if not exists (select 1 from public.ports p where p.locode = v_port) then
      raise exception 'BUNKER_QUOTE: unknown port %', v_port using errcode = '22023';
    end if;
    insert into public.bunker_supplier_ports (supplier_id, port_locode)
    values (p_supplier_id, v_port) on conflict do nothing;
  end if;
  return public.fn_bunker_record_quote(p_supplier_id, p_quote,
    case when v_platform then 'admin_input' else 'admin_override' end, p_actor, true, btrim(p_reason));
end;
$$;
revoke all on function public.admin_bunker_override_quote(uuid, uuid, jsonb, text) from public, anon, authenticated;

-- ── 1 · ticker: only valid quotes, judged per product ───────────────────────
create or replace function public.get_bunker_ticker()
returns jsonb
language sql stable security definer set search_path to ''
as $$
  with live as (
    select q.supplier_id, q.port_locode, q.product_key, q.price, q.submitted_at,
           (select prev.price
              from public.bunker_quotes prev
             where prev.supplier_id = q.supplier_id and prev.port_locode = q.port_locode
               and prev.product_key = q.product_key
               and prev.superseded_at is not null  -- only a once-live quote is a previous price
               and prev.submitted_at < q.submitted_at
             order by prev.submitted_at desc limit 1) as prev_price
      from public.bunker_quotes q
      join public.bunker_suppliers s
        on s.id = q.supplier_id and s.status = 'enabled' and not s.is_platform
      join public.fuel_products f on f.key = q.product_key and f.is_active
     where q.status = 'approved'
       and q.superseded_at is null
       and q.submitted_at <= now()
       and q.valid_from <= now()
       and q.valid_until >= now()
       and now() - q.submitted_at <= interval '21 days'
  ), rows as (
    select l.supplier_id, l.port_locode, max(l.submitted_at) as latest
      from live l
     group by l.supplier_id, l.port_locode
  ), shaped as (
    select r.*, s.name, s.url, coalesce(p.trade_name, r.port_locode) as port_name,
           public.fn_bunker_freshness(now() - r.latest) as freshness,
           floor(extract(epoch from now() - r.latest) / 86400)::int as age_days
      from rows r
      join public.bunker_suppliers s on s.id = r.supplier_id
      join public.ports p on p.locode = r.port_locode
  )
  select jsonb_build_object(
    'asOf', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'sponsors', coalesce(jsonb_agg(jsonb_build_object(
        'name', sh.name,
        'url', sh.url,
        'port', sh.port_name,
        'portLocode', sh.port_locode,
        'freshness', sh.freshness,
        'ageDays', sh.age_days,
        'latestQuoteAt', to_char(date_trunc('hour', sh.latest at time zone 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'prices', (
          select jsonb_agg(jsonb_build_object(
                   'productKey', l.product_key,
                   'label', f.market_label,
                   'usdMt', l.price,
                   'direction', case
                     when l.prev_price is null or l.prev_price = l.price then 'flat'
                     when l.price > l.prev_price then 'up' else 'down' end
                 ) order by f.sort_order)
            from live l join public.fuel_products f on f.key = l.product_key
           where l.supplier_id = sh.supplier_id and l.port_locode = sh.port_locode)
      ) order by case sh.freshness when 'current' then 0 when 'stale' then 1 else 2 end,
                 sh.name, sh.port_name), '[]'::jsonb))
    from shaped sh
$$;
revoke all on function public.get_bunker_ticker() from public, anon;
grant execute on function public.get_bunker_ticker() to authenticated, service_role;

-- ── 6 · freshness alerts and "last quote" count only quotes valid now ─────
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
                           where q.supplier_id = s.id and q.status = 'approved' and q.superseded_at is null
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
                                and q.superseded_at is null
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
