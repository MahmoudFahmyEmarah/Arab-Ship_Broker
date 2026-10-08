-- DOWN for 20261009300000 (stored recap PDF). Refuses while any PDF is recorded: the records (and their bucket
-- objects) are the history of what was published. Otherwise removes the three functions, the trigger and the table.
do $$
begin
  -- nested: PL/pgSQL plans a whole IF expression, so the table is named only once it is known to exist
  if to_regclass('public.fixture_recap_pdfs') is not null then
    if exists (select 1 from public.fixture_recap_pdfs) then
      raise exception 'FX_DOWN_REFUSED: stored recap PDFs are recorded; export them before removing the module' using errcode = '55000';
    end if;
  end if;
end $$;
drop function if exists public.get_fixture_recap_pdf(uuid, integer);
drop function if exists public.record_fixture_recap_pdf(uuid, text, text, integer, text);
drop function if exists public.fixture_recap_pdf_source(uuid);
drop table if exists public.fixture_recap_pdfs;
drop function if exists public.fn_fixture_recap_pdf_no_update();
