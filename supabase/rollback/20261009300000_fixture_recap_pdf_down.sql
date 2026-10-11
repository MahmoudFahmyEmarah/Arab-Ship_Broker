-- DOWN for 20261009300000 (stored recap PDF). Refuses while any record exists (the records are the history of what
-- was published) and while the fixture-recaps bucket holds any object (a stored file, or an orphan from an upload
-- whose record never finalized — purge orphans with the store's reconcile first). Otherwise removes the module.
do $$
begin
  -- nested: PL/pgSQL plans a whole IF expression, so each table is named only once it is known to exist
  if to_regclass('public.fixture_recap_pdfs') is not null then
    if exists (select 1 from public.fixture_recap_pdfs) then
      raise exception 'FX_DOWN_REFUSED: stored recap PDFs are recorded; export them before removing the module' using errcode = '55000';
    end if;
  end if;
  if to_regclass('storage.objects') is not null then
    if exists (select 1 from storage.objects where bucket_id = 'fixture-recaps') then
      raise exception 'FX_DOWN_REFUSED: the fixture-recaps bucket still holds files; reconcile and export them first' using errcode = '55000';
    end if;
  end if;
end $$;
drop function if exists public.get_fixture_recap_pdf(uuid, integer);
drop function if exists public.fixture_recap_pdf_bound_paths(uuid);
drop function if exists public.finalize_fixture_recap_pdf(uuid, text, boolean, text);
drop function if exists public.bind_fixture_recap_pdf(uuid, text, text, integer, text);
drop function if exists public.fixture_recap_pdf_source(uuid);
drop table if exists public.fixture_recap_pdfs;
drop function if exists public.fn_fixture_recap_pdf_append_only();
-- the released recap text function of 20260923201000, verbatim
create or replace function public.fn_fixture_recap_text(c jsonb)
 returns text language plpgsql immutable set search_path to ''
as $$
declare l text[] := '{}'; t jsonb; s jsonb; p jsonb; v text;
begin
  l := array_append(l, format('FIXTURE RECAP · %s / %s', c->'cargo'->>'commodity', c->'vessel'->>'name'));
  l := array_append(l, format('Ref %s · room v%s · %s', c->>'ref', c->>'roomVersion', to_char((c->>'generatedAt')::timestamptz, 'DD Mon YYYY HH24:MI "UTC"')));
  l := array_append(l, format('Status: %s', upper(replace(c->>'status', '_', ' '))));
  l := array_append(l, '');
  l := array_append(l, format('Cargo:  %s · %s–%s MT · %s → %s', c->'cargo'->>'commodity', c->'cargo'->>'qtyMin', c->'cargo'->>'qtyMax', c->'cargo'->>'loadPort', c->'cargo'->>'dischPort'));
  l := array_append(l, format('Vessel: %s (%s · %s DWT)', c->'vessel'->>'name', c->'vessel'->>'type', c->'vessel'->>'dwt'));
  l := array_append(l, '');
  l := array_append(l, 'PARTIES');
  for p in select * from jsonb_array_elements(c->'parties') loop
    l := array_append(l, format('- %s%s', p->>'label', case when p->>'name' is not null then ' · ' || (p->>'name') else '' end));
  end loop;
  l := array_append(l, '');
  l := array_append(l, 'MAIN TERMS');
  for t in select * from jsonb_array_elements(c->'terms') loop
    v := case when t->>'status' = 'agreed' then format('%s  [AGREED]', t->>'agreedValue')
              when t->>'status' = 'withdrawn' then '[WITHDRAWN]'
              else format('cargo %s · vessel %s  [OPEN]', coalesce(t->>'cargoPosition', '—'), coalesce(t->>'vesselPosition', '—')) end;
    l := array_append(l, format('%s. %s: %s', t->>'sortOrder', t->>'label', v));
  end loop;
  l := array_append(l, '');
  l := array_append(l, 'SUBJECTS');
  if jsonb_array_length(coalesce(c->'subjects', '[]'::jsonb)) = 0 then
    l := array_append(l, '- none recorded');
  end if;
  for s in select * from jsonb_array_elements(c->'subjects') loop
    l := array_append(l, format('- %s [%s]%s', s->>'title', upper(s->>'status'), case when s->>'deadlineAt' is not null then ' · by ' || to_char((s->>'deadlineAt')::timestamptz, 'DD Mon YYYY HH24:MI "UTC"') else '' end));
  end loop;
  l := array_append(l, '');
  l := array_append(l, format('Counterparty identity: %s', case when (c->>'counterpartyDisclosed')::boolean then 'disclosed' else 'withheld · via Arab ShipBroker' end));
  if c->'brokerageTerms' is not null and jsonb_typeof(c->'brokerageTerms') <> 'null' then
    l := array_append(l, format('Brokerage: %s', coalesce(c->'brokerageTerms'->>'text', c->'brokerageTerms'::text)));
  end if;
  l := array_append(l, 'Sub all terms / details of C/P otherwise as per owners'' proforma.');
  return array_to_string(l, E'\n');
end $$;
revoke all on function public.fn_fixture_recap_text(jsonb) from public, anon, authenticated;
