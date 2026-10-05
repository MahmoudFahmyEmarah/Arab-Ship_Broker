-- Fuel Bar pilot suppliers (owner ruling, 4 Oct 2026): O Bunker, Bahri Bunker
-- and التعاون للبترول are registered so the pilot can start. Their contacts,
-- websites and ports are PLACEHOLDERS until the owner supplies real details;
-- every field is edited on /admin/bunker → Suppliers & access (and a member
-- account is linked there as the supplier's editor).
--
-- What this does NOT do: no prices, no member links, not verified. A supplier
-- appears on the ticker only once it has a live approved quote, so nothing
-- reaches members until a real person publishes a real price.
-- Placeholder rows are recognisable by notes starting "PILOT PLACEHOLDER" and
-- contact emails at example.invalid; the admin page flags them.
-- Idempotent: an existing supplier with the same name is left untouched.

do $$
declare
  r record;
  v_id uuid;
begin
  for r in
    select * from (values
      ('O Bunker',         'pilot-o-bunker@example.invalid',     array['EGPSD', 'EGSOK'], 'EGPSD'),
      ('Bahri Bunker',     'pilot-bahri-bunker@example.invalid', array['EGALY', 'EGDAM'], 'EGALY'),
      ('التعاون للبترول',  'pilot-altaawon@example.invalid',     array['EGSOK', 'EGPSD'], 'EGSOK')
    ) as t(name, email, ports, primary_port)
  loop
    if exists (select 1 from public.bunker_suppliers s where lower(btrim(s.name)) = lower(btrim(r.name))) then
      continue;
    end if;
    insert into public.bunker_suppliers
      (name, country, verified, status, trust_score, contact_name, contact_email, notes)
    values
      (r.name, 'Egypt', false, 'enabled', 50, 'PLACEHOLDER — replace with the real contact', r.email,
       'PILOT PLACEHOLDER: contact, website and ports are sample data. Replace them on /admin/bunker, '
       || 'link the supplier''s member account as editor, then mark verified if they are a first-hand physical supplier.')
    returning id into v_id;

    insert into public.bunker_supplier_ports (supplier_id, port_locode, is_primary)
    select v_id, p.locode, p.locode = r.primary_port
      from unnest(r.ports) as u(code)
      join public.ports p on p.locode = u.code
    on conflict do nothing;
  end loop;
end;
$$;
