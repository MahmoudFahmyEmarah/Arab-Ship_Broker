// Prints the Fuel Bar SQL suite: the shared fixtures loaded into a database,
// get_fuel_price_index asserted against the same expectations as
// scripts/bunker-check.ts (SQL/TypeScript parity), then lifecycle, identity,
// idempotency, append-only, ticker and grant checks. Everything runs in one
// transaction that is rolled back, and existing suppliers are disabled inside
// it, so the suite neither depends on nor changes the data it runs over.
//   node --import tsx scripts/bunker-sql-suite.ts | \
//     docker exec -i supabase_db_arab-ship-broker psql -U postgres -d asb_bunker -v ON_ERROR_STOP=1 -q
import { AS_OF, INDEX_CASES, PORTS, QUOTES, SUPPLIERS } from "./bunker-fixtures";

const lit = (v: string | number | boolean | null | undefined) =>
  v === null || v === undefined ? "null" : typeof v === "string" ? `'${v.replace(/'/g, "''")}'` : String(v);

const MEMBER_SUB = "00000000-0000-4000-a000-0000000000e1";
const VIEWER_SUB = "00000000-0000-4000-a000-0000000000e2";
const OUTSIDER_SUB = "00000000-0000-4000-a000-0000000000e3";
const ADMIN_ID = "00000000-0000-4000-a000-0000000000ad";
const out: string[] = [];
const sql = (s: string) => out.push(s.trim());

sql(`\\set QUIET on
begin;
set local client_min_messages = warning;
update public.bunker_suppliers set status = 'disabled' where status = 'enabled';`);

// ── Fixtures ────────────────────────────────────────────────────────────────
for (const s of SUPPLIERS) {
  if (s.platform) {
    // only one platform supplier may exist: step the real one aside (rolled back)
    sql(`update public.bunker_suppliers set is_platform = false where is_platform;
insert into public.bunker_suppliers (id, name, status, verified, is_platform)
values (${lit(s.id)}, ${lit(s.name)}, 'enabled', true, true);`);
  } else {
    sql(`insert into public.bunker_suppliers (id, name, status, verified) values
  (${lit(s.id)}, ${lit(s.name)}, ${lit(s.enabled ? "enabled" : "disabled")}, true);`);
  }
}
for (const p of PORTS.filter((x) => x.eca)) {
  sql(`insert into public.bunker_port_flags (port_locode, eca_zone) values (${lit(p.locode)}, 'MED')
  on conflict (port_locode) do update set eca_zone = 'MED';`);
}
sql(`delete from public.bunker_port_flags where port_locode in (${PORTS.filter((x) => !x.eca).map((p) => lit(p.locode)).join(", ")});`);
for (const q of QUOTES) {
  sql(`insert into public.bunker_quotes (id, supplier_id, port_locode, product_key, price, min_qty_mt,
  barge_fee_usd, mandatory_charges_usd, valid_from, valid_until, source, status, submitted_at, superseded_at)
values (${lit(q.id)}, ${lit(q.supplierId)}, ${lit(q.portLocode)}, ${lit(q.productKey)}, ${q.price}, ${lit(q.minQtyMt)},
  ${q.bargeFeeUsd}, ${q.mandatoryChargesUsd}, ${lit(q.validFrom)}, ${lit(q.validUntil)}, 'admin_input', ${lit(q.status)},
  ${lit(q.submittedAt)}, ${lit(q.supersededAt)}); -- ${q.note}`);
}

// ── Index parity cases ──────────────────────────────────────────────────────
const asMember = `set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"${MEMBER_SUB}"}', true);`;
const asOwner = `reset role;
select set_config('request.jwt.claims', '', true);`;

for (const c of INDEX_CASES) {
  const p = c.params;
  const call = `public.get_fuel_price_index(${lit(p.portLocode)}, ${
    p.productKeys ? `array[${p.productKeys.map(lit).join(",")}]::text[]` : "null"
  }, ${lit(p.asOf)}::timestamptz${p.stemMt !== undefined ? `, ${p.stemMt}` : ""})`;
  sql(p.viewer === "member" ? asMember : asOwner);
  if ("error" in c.expected) {
    sql(`do $t$ begin
  perform ${call};
  raise exception '${c.id} FAILED: expected ${c.expected.error}';
exception when sqlstate '22023' then
  if sqlerrm not like '${c.expected.error}%' then raise exception '${c.id} FAILED: wrong error %', sqlerrm; end if;
end $t$;`);
  } else {
    sql(`do $t$ declare got jsonb := ${call}; exp jsonb := ${lit(JSON.stringify(c.expected))}::jsonb;
begin
  if got is distinct from exp then raise exception E'${c.id} FAILED\\n got %\\n exp %', got, exp; end if;
end $t$;`);
  }
  sql(`select '${c.id} ok';`);
}
sql(asOwner);

// ── Never zero, append-only, lifecycle ──────────────────────────────────────
const A = SUPPLIERS[0].id;
const B = SUPPLIERS[1].id;
sql(`
do $t$ begin
  insert into public.bunker_quotes (supplier_id, port_locode, product_key, price, valid_from, valid_until, source, status)
  values ('${A}', 'GRPIR', 'VLSFO', 0, now(), now() + interval '1 day', 'admin_input', 'approved');
  raise exception 'Z1 FAILED: zero price accepted';
exception when check_violation then null;
end $t$;
select 'Z1 ok: zero price refused';

do $t$ begin
  update public.bunker_quotes set price = 1 where id = '${QUOTES[1].id}';
  raise exception 'A1 FAILED: price edited';
exception when sqlstate '55000' then null;
end $t$;
do $t$ begin
  delete from public.bunker_quotes where id = '${QUOTES[1].id}';
  raise exception 'A2 FAILED: quote deleted';
exception when sqlstate '55000' then null;
end $t$;
do $t$ begin
  update public.bunker_quotes set status = 'submitted' where id = '${QUOTES[1].id}';
  raise exception 'A3 FAILED: approved -> submitted';
exception when sqlstate '55000' then null;
end $t$;
do $t$ begin
  update public.bunker_quote_events set reason = 'x' where true;
  delete from public.bunker_quote_events where true;
  if exists (select 1 from public.bunker_quote_events) then
    raise exception 'A4 FAILED: events changed';
  end if;
exception when sqlstate '55000' then null;
end $t$;
select 'A1-A4 ok: append-only';
`);

// Member accounts and supplier ports for the command tests.
sql(`
insert into auth.users (id, email) values
  ('${MEMBER_SUB}', 'src-bunker-e2e-editor@example.invalid'),
  ('${VIEWER_SUB}', 'src-bunker-e2e-viewer@example.invalid'),
  ('${OUTSIDER_SUB}', 'src-bunker-e2e-outsider@example.invalid'),
  ('${ADMIN_ID}', 'src-bunker-e2e-admin@example.invalid');
insert into public.users (id, supabase_user_id, email, full_name, role, is_active) values
  ('${MEMBER_SUB}', '${MEMBER_SUB}', 'src-bunker-e2e-editor@example.invalid', 'src:bunker-e2e editor', 'user', true),
  ('${VIEWER_SUB}', '${VIEWER_SUB}', 'src-bunker-e2e-viewer@example.invalid', 'src:bunker-e2e viewer', 'user', true),
  ('${OUTSIDER_SUB}', '${OUTSIDER_SUB}', 'src-bunker-e2e-outsider@example.invalid', 'src:bunker-e2e outsider', 'user', true)
on conflict (id) do update set supabase_user_id = excluded.supabase_user_id, role = 'user', is_active = true;
insert into public.bunker_supplier_ports (supplier_id, port_locode, is_primary) values
  ('${A}', 'GRPIR', true), ('${B}', 'GRPIR', true), ('${B}', 'CYLCA', false);
insert into public.bunker_supplier_members (supplier_id, user_id, role) values
  ('${A}', '${MEMBER_SUB}', 'editor'),
  ('${B}', '${VIEWER_SUB}', 'viewer');
update public.bunker_suppliers set verified = false where id = '${A}';
`);

const as = (sub: string) => `set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"${sub}"}', true);`;
const item = (extra = "") =>
  `'[{"portLocode":"grpir","productKey":"VLSFO","priceUsdMt":598,"validUntil":"' || (now() + interval '10 days')::text || '","clientRef":"r1"${extra}}]'`;

sql(`
${as(MEMBER_SUB)}
do $t$ declare r jsonb;
begin
  r := public.supplier_upsert_quotes((${item()})::jsonb);
  if r->'results'->0->>'status' <> 'submitted' or (r->>'autoApproved')::boolean then
    raise exception 'L1 FAILED: unverified supplier quote not pending: %', r; end if;
  -- replay is idempotent
  if (public.supplier_upsert_quotes((${item()})::jsonb))->'results'->0->>'duplicate' <> 'true' then
    raise exception 'L2 FAILED: replay not idempotent'; end if;
end $t$;
select 'L1-L2 ok: pending until approved, replay idempotent';

do $t$ begin
  perform public.supplier_upsert_quotes(('[{"portLocode":"GRPIR","productKey":"VLSFO","priceUsdMt":599,"validUntil":"' || (now() + interval '10 days')::text || '","clientRef":"r1"}]')::jsonb);
  raise exception 'L3 FAILED: clientRef reused for other content';
exception when unique_violation then null;
end $t$;
do $t$ begin
  perform public.supplier_upsert_quotes(('[{"portLocode":"CYLCA","productKey":"VLSFO","priceUsdMt":599,"clientRef":"l4","validUntil":"' || (now() + interval '10 days')::text || '"}]')::jsonb);
  raise exception 'L4 FAILED: unregistered port accepted';
exception when sqlstate '22023' then null;
end $t$;
do $t$ begin
  perform public.supplier_upsert_quotes(('[{"portLocode":"GRPIR","productKey":"VLSFO","priceUsdMt":0,"clientRef":"l5","validUntil":"' || (now() + interval '10 days')::text || '"}]')::jsonb);
  raise exception 'L5 FAILED: zero price accepted';
exception when sqlstate '22023' then null;
end $t$;
do $t$ begin
  perform public.supplier_upsert_quotes(('[{"portLocode":"GRPIR","productKey":"VLSFO","priceUsdMt":600,"clientRef":"l6","validUntil":"' || (now() - interval '1 hour')::text || '"}]')::jsonb);
  raise exception 'L6 FAILED: expired validity accepted';
exception when sqlstate '22023' then null;
end $t$;
do $t$ begin
  perform public.supplier_upsert_quotes((${item()})::jsonb, '${B}');
  raise exception 'M1 FAILED: acted for a supplier it does not belong to';
exception when insufficient_privilege then null;
end $t$;
do $t$ begin
  update public.bunker_quotes set status = 'approved' where status = 'submitted';
  raise exception 'M2 FAILED: member wrote the table directly';
exception when insufficient_privilege then null;
end $t$;
do $t$ begin
  perform 1 from public.bunker_suppliers;
  raise exception 'M3 FAILED: member read suppliers (contacts) directly';
exception when insufficient_privilege then null;
end $t$;
do $t$ begin
  perform public.fn_bunker_approve_quote((select null::uuid), null, null);
  raise exception 'M4 FAILED: member reached the approval helper';
exception when insufficient_privilege then null;
end $t$;
do $t$ declare r jsonb := public.supplier_list_my_quotes();
begin
  if jsonb_array_length(r->'suppliers') <> 1 or r->'suppliers'->0->>'id' <> '${A}' then
    raise exception 'M5 FAILED: portal state wrong: %', r; end if;
  if r::text ~ 'contact' then raise exception 'M5 FAILED: contact field in portal state'; end if;
end $t$;
select 'L3-L6, M1-M5 ok: validation, membership refusal, no direct access';

${as(VIEWER_SUB)}
do $t$ begin
  perform public.supplier_upsert_quotes((${item()})::jsonb);
  raise exception 'M6 FAILED: viewer submitted a quote';
exception when insufficient_privilege then null;
end $t$;
${as(OUTSIDER_SUB)}
do $t$ begin
  perform public.supplier_upsert_quotes((${item()})::jsonb);
  raise exception 'M7 FAILED: outsider submitted a quote';
exception when insufficient_privilege then null;
end $t$;
select 'M6-M7 ok: viewer and outsider refused';
reset role;
select set_config('request.jwt.claims', '', true);
`);

// Approval supersedes the previous live quote; the ticker shows direction.
sql(`
insert into public.users (id, supabase_user_id, email, full_name, role, is_active, admin_tier) values
  ('${ADMIN_ID}', '${ADMIN_ID}', 'src-bunker-e2e-admin@example.invalid', 'src:bunker-e2e admin', 'admin', true, 'super')
on conflict (id) do update set role = 'admin', admin_tier = 'super', is_active = true;
do $t$ declare v_pending uuid; v_prev uuid := '${QUOTES[1].id}';
begin
  select id into v_pending from public.bunker_quotes where supplier_id = '${A}' and status = 'submitted';
  perform public.admin_bunker_decide_quote('${ADMIN_ID}', v_pending, 'approve', null);
  if (select superseded_at from public.bunker_quotes where id = v_prev) is null then
    raise exception 'L7 FAILED: approval did not supersede the previous live quote'; end if;
  if (select count(*) from public.bunker_quotes where supplier_id = '${A}' and port_locode = 'GRPIR'
        and product_key = 'VLSFO' and status = 'approved' and superseded_at is null) <> 1 then
    raise exception 'L7 FAILED: not exactly one live quote'; end if;
end $t$;
do $t$ begin
  perform public.admin_bunker_decide_quote('${MEMBER_SUB}', '${QUOTES[1].id}', 'approve', null);
  raise exception 'L8 FAILED: non-admin actor approved';
exception when insufficient_privilege then null;
end $t$;
select 'L7-L8 ok: approval supersedes, only admins decide';

-- C2B-002 #1: per-product validity on the ticker (A at GRPIR keeps a live VLSFO).
insert into public.bunker_quotes (supplier_id, port_locode, product_key, price, valid_from, valid_until, source, status, submitted_at)
values ('${A}', 'GRPIR', 'MGO05', 777, now() - interval '3 days', now() - interval '1 hour', 'admin_input', 'approved', now() - interval '3 days'),
       ('${A}', 'GRPIR', 'HSFO380', 444, now() + interval '1 day', now() + interval '9 days', 'admin_input', 'approved', now() - interval '1 hour');

-- C2B-002 #3: idempotency covers every term (validFrom omitted on both sides).
${as(MEMBER_SUB)}
do $t$ declare r jsonb; ref text := 'full-' || txid_current();
  base jsonb := jsonb_build_object('portLocode','GRPIR','productKey','LSMGO','priceUsdMt',801,
                 'validUntil',(now() + interval '5 days')::text,'bargeFeeUsd',100,'minQtyMt',200,'clientRef',ref);
begin
  r := public.supplier_upsert_quotes(jsonb_build_array(base));
  if r->'results'->0->>'duplicate' <> 'false' then raise exception 'L9 FAILED: first use reported duplicate'; end if;
  r := public.supplier_upsert_quotes(jsonb_build_array(base || jsonb_build_object('priceUsdMt', 801.00)));
  if r->'results'->0->>'duplicate' <> 'true' then raise exception 'L9 FAILED: identical replay (801 vs 801.00) not a duplicate'; end if;
  begin
    perform public.supplier_upsert_quotes(jsonb_build_array(base || jsonb_build_object('bargeFeeUsd', 150)));
    raise exception 'L9 FAILED: reused clientRef with a different barge fee accepted';
  exception when unique_violation then null;
  end;
  begin
    perform public.supplier_upsert_quotes(jsonb_build_array(base || jsonb_build_object('deliveryMode', 'truck')));
    raise exception 'L9 FAILED: reused clientRef with a different delivery mode accepted';
  exception when unique_violation then null;
  end;
  -- C2B-002 hardening: a replaced pending quote is audited.
  perform public.supplier_upsert_quotes(jsonb_build_array(
    jsonb_build_object('portLocode','GRPIR','productKey','LSMGO','priceUsdMt',805,'clientRef','l10',
                       'validUntil',(now() + interval '5 days')::text)));
end $t$;
reset role;
select set_config('request.jwt.claims', '', true);
do $t$ begin
  if not exists (select 1 from public.bunker_quote_events e join public.bunker_quotes q on q.id = e.quote_id
                  where e.action = 'withdraw' and q.supplier_id = '${A}' and q.price = 801
                    and e.reason = 'replaced by a newer submission') then
    raise exception 'L10 FAILED: replaced pending quote left no withdraw event'; end if;
  if (select count(*) from public.bunker_quotes where supplier_id = '${A}' and port_locode = 'GRPIR'
        and product_key = 'LSMGO' and status = 'submitted') <> 1 then
    raise exception 'L10 FAILED: not exactly one pending quote'; end if;
end $t$;
select 'L9-L10 ok: idempotency binds every term; replaced pending quote audited';

-- Staff input under the platform supplier registers an unregistered port.
do $t$ declare v_platform uuid := (select id from public.bunker_suppliers where is_platform);
begin
  perform public.admin_bunker_override_quote('${ADMIN_ID}', v_platform,
    jsonb_build_object('portLocode','CYLCA','productKey','MDO','priceUsdMt',900,'validUntil',(now() + interval '3 days')::text),
    'phoned price');
  if not exists (select 1 from public.bunker_supplier_ports where supplier_id = v_platform and port_locode = 'CYLCA') then
    raise exception 'L11 FAILED: platform port not registered'; end if;
end $t$;
select 'L11 ok: platform input registers its port';

-- C2B-003 #1: a keyless supplier submission (and a repeated key in one batch) is refused.
${as(MEMBER_SUB)}
do $t$ begin
  begin
    perform public.supplier_upsert_quotes(jsonb_build_array(jsonb_build_object(
      'portLocode','GRPIR','productKey','VLSFO','priceUsdMt',611,'validUntil',(now() + interval '5 days')::text)));
    raise exception 'L12 FAILED: keyless submission accepted';
  exception when sqlstate '22023' then
    if sqlerrm not like '%clientRef%' then raise exception 'L12 FAILED: wrong error %', sqlerrm; end if;
  end;
  begin
    perform public.supplier_upsert_quotes(jsonb_build_array(
      jsonb_build_object('portLocode','GRPIR','productKey','VLSFO','priceUsdMt',611,'clientRef','dup','validUntil',(now() + interval '5 days')::text),
      jsonb_build_object('portLocode','GRPIR','productKey','HSFO380','priceUsdMt',511,'clientRef','dup','validUntil',(now() + interval '5 days')::text)));
    raise exception 'L12 FAILED: repeated key within a batch accepted';
  exception when sqlstate '22023' then null;
  end;
end $t$;
reset role;
select set_config('request.jwt.claims', '', true);
select 'L12 ok: clientRef required and unique per batch';

-- C2B-003 #4: at the 500/day boundary a replay still succeeds, a new key does not.
insert into public.bunker_quote_events (supplier_id, port_locode, product_key, action, created_at)
select '${A}', 'GRPIR', 'VLSFO', 'submit', now() from generate_series(1, 500);
${as(MEMBER_SUB)}
do $t$ declare r jsonb;
  base jsonb := jsonb_build_object('portLocode','GRPIR','productKey','LSMGO','priceUsdMt',805,'clientRef','l10',
                                   'validUntil',(now() + interval '5 days')::text);
begin
  r := public.supplier_upsert_quotes(jsonb_build_array(base));
  if r->'results'->0->>'duplicate' <> 'true' then raise exception 'L13 FAILED: replay at the limit not a duplicate: %', r; end if;
  begin
    perform public.supplier_upsert_quotes(jsonb_build_array(base || jsonb_build_object('clientRef', 'brand-new')));
    raise exception 'L13 FAILED: new key accepted past the daily limit';
  exception when sqlstate '54000' then null;
  end;
end $t$;
reset role;
select set_config('request.jwt.claims', '', true);
set session_replication_role = replica;  -- remove the synthetic rate rows (events are append-only)
delete from public.bunker_quote_events where supplier_id = '${A}' and quote_id is null and action = 'submit';
set session_replication_role = origin;
select 'L13 ok: replays exempt from the daily limit';

-- C2B-003 #3: a row keyed before 105000 (no command hash) replays on identical terms.
insert into public.bunker_quotes (supplier_id, port_locode, product_key, price, delivery_mode, min_qty_mt,
  barge_fee_usd, mandatory_charges_usd, valid_from, valid_until, source, status, client_ref, command_sha256, submitted_at)
values ('${A}', 'GRPIR', 'ULSFO', 700, 'barge', 300, 1000, 0, now() - interval '1 hour',
        date_trunc('hour', now()) + interval '6 days', 'supplier', 'submitted', 'legacy-1', null, now() - interval '1 hour');
${as(MEMBER_SUB)}
do $t$ declare r jsonb;
  base jsonb := jsonb_build_object('portLocode','GRPIR','productKey','ULSFO','priceUsdMt',700,'minQtyMt',300,
                 'bargeFeeUsd',1000,'clientRef','legacy-1','validUntil',(date_trunc('hour', now()) + interval '6 days')::text);
begin
  r := public.supplier_upsert_quotes(jsonb_build_array(base));
  if r->'results'->0->>'duplicate' <> 'true' then raise exception 'L14 FAILED: legacy keyed row did not replay: %', r; end if;
  begin
    perform public.supplier_upsert_quotes(jsonb_build_array(base || jsonb_build_object('priceUsdMt', 701)));
    raise exception 'L14 FAILED: legacy key reused with another price';
  exception when unique_violation then null;
  end;
end $t$;
reset role;
select set_config('request.jwt.claims', '', true);
select 'L14 ok: pre-105000 keyed rows replay by their stored terms';

-- Inactive accounts cannot open the portal state.
update public.users set is_active = false where id = '${VIEWER_SUB}';
${as(VIEWER_SUB)}
do $t$ begin
  perform public.supplier_list_my_quotes();
  raise exception 'M8 FAILED: inactive member read the portal state';
exception when insufficient_privilege then null;
end $t$;
-- Port flags: facts through the RPC, no direct table read, no identity or notes.
do $t$ declare f jsonb := public.get_bunker_port_flags(array['TRMER']);
begin
  if f->0->>'ecaZone' is distinct from 'MED' then raise exception 'P1 FAILED: flags RPC wrong: %', f; end if;
  if f::text ~ '(updated|notes|By)' then raise exception 'P1 FAILED: flags RPC leaks identity/notes: %', f; end if;
  begin
    perform 1 from public.bunker_port_flags;
    raise exception 'P1 FAILED: member read bunker_port_flags directly';
  exception when insufficient_privilege then null;
  end;
end $t$;
reset role;
select set_config('request.jwt.claims', '', true);
update public.users set is_active = true where id = '${VIEWER_SUB}';
select 'M8, P1 ok: inactive member refused; port flags private except the facts';

${as(MEMBER_SUB)}
do $t$ declare t jsonb := public.get_bunker_ticker(); row jsonb;
begin
  select x into row from jsonb_array_elements(t->'sponsors') x
   where x->>'name' = 'src:bunker-e2e A' and x->>'portLocode' = 'GRPIR';
  if row is null then raise exception 'T1 FAILED: sponsor A missing: %', t; end if;
  if (select p->>'direction' from jsonb_array_elements(row->'prices') p where p->>'productKey' = 'VLSFO') <> 'down' then
    raise exception 'T1 FAILED: 600 -> 598 should be down: %', row; end if;
  if exists (select 1 from jsonb_array_elements(row->'prices') p where p->>'productKey' in ('MGO05', 'HSFO380')) then
    raise exception 'T4 FAILED: lapsed or future-effective quote on the ticker: %', row; end if;
  if row->>'freshness' <> 'current' then raise exception 'T4 FAILED: row freshness %', row->>'freshness'; end if;
  if t::text ~ '(Platform|src:bunker-e2e D|supplierId|contact|00000000-0000-4000-b000)' then
    raise exception 'T2 FAILED: platform, disabled supplier or ids in ticker: %', t; end if;
  if exists (select 1 from jsonb_array_elements(t->'sponsors') x, jsonb_array_elements(x->'prices') p
              where (p->>'usdMt')::numeric <= 0) then
    raise exception 'T3 FAILED: zero price on ticker'; end if;
end $t$;
select 'T1-T4 ok: ticker direction, per-product validity, no platform/disabled/ids, never zero';
do $t$ declare v_live uuid; v_new jsonb; t jsonb;
begin
  -- as the member: find the live quote through the portal RPC, withdraw it, republish higher
  select (q->>'id')::uuid into v_live
    from jsonb_array_elements((public.supplier_list_my_quotes())->'suppliers'->0->'quotes') q
   where q->>'portLocode' = 'GRPIR' and q->>'productKey' = 'VLSFO' and q->>'status' = 'approved';
  perform public.supplier_withdraw_quote(v_live, 'wrong price');
  v_new := public.supplier_upsert_quotes(jsonb_build_array(jsonb_build_object(
    'portLocode','GRPIR','productKey','VLSFO','priceUsdMt',650,'clientRef','t5','validUntil',(now() + interval '5 days')::text)));
  reset role;
  if (select superseded_at from public.bunker_quotes where id = v_live) is null then
    raise exception 'T5 FAILED: withdrawing a live quote left superseded_at empty'; end if;
  perform public.admin_bunker_decide_quote('${ADMIN_ID}', (v_new->'results'->0->>'quoteId')::uuid, 'approve', null);
  t := public.get_bunker_ticker();
  if (select p->>'direction' from jsonb_array_elements(t->'sponsors') x, jsonb_array_elements(x->'prices') p
       where x->>'name' = 'src:bunker-e2e A' and x->>'portLocode' = 'GRPIR' and p->>'productKey' = 'VLSFO') <> 'up' then
    raise exception 'T5 FAILED: withdraw (598) then republish (650) should read up: %', t; end if;
end $t$;
select 'T5 ok: a withdrawn live price stays the previous price';
reset role;
select set_config('request.jwt.claims', '', true);
`);

// Grants: anon reaches nothing; members only the five member RPCs.
sql(`
do $t$ declare bad text;
begin
  select string_agg(p.proname, ', ') into bad from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and (p.proname like '%bunker%' or p.proname = 'get_fuel_price_index')
     and has_function_privilege('anon', p.oid, 'execute');
  if bad is not null then raise exception 'G1 FAILED: anon can execute %', bad; end if;
  select string_agg(p.proname, ', ') into bad from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and (p.proname like '%bunker%' or p.proname = 'get_fuel_price_index')
     and has_function_privilege('authenticated', p.oid, 'execute')
     and p.proname not in ('get_fuel_price_index', 'get_bunker_ticker', 'supplier_upsert_quotes',
                           'supplier_withdraw_quote', 'supplier_list_my_quotes', 'get_bunker_port_flags');
  if bad is not null then raise exception 'G2 FAILED: members can execute %', bad; end if;
  select string_agg(c.relname, ', ') into bad from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname like 'bunker%' and c.relkind = 'r'
     and (has_table_privilege('authenticated', c.oid, 'select') or has_table_privilege('anon', c.oid, 'select'));
  if bad is not null then raise exception 'G3 FAILED: members can read %', bad; end if;
end $t$;
select 'G1-G3 ok: grants';
`);

sql(`rollback;
select 'bunker SQL suite: ALL ASSERTIONS PASSED (rolled back; as_of ${AS_OF})';`);

console.log(out.join("\n\n"));
