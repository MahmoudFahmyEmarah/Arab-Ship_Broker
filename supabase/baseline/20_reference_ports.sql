-- ════════════════════════════════════════════════════════════════════════
-- Reference ports a clean build needs before the port-identity migration
-- (21 Sep 2026)
--
-- 20260910100000_port_identity_layer.sql inserts the port_areas registry, and
-- every ref_locode / candidate_locode in it is a foreign key into
-- public.ports. On the live project those ports already existed, so the
-- INSERT succeeded and the migration's own "keep only ports that really
-- exist" cleanup had nothing to remove. On an EMPTY database the insert fails
-- on the first key, which is where a rebuild from migrations alone stopped.
--
-- These 118 rows are the codes that migration names, as PLACEHOLDERS:
-- the LOCODE stands in for the trade name, the country is the LOCODE's own
-- country prefix, and the zone is the one the area registry assigns. They are
-- inserted `on conflict do nothing`, so on any database that already has real
-- ports this file changes nothing at all.
--
-- A real disaster recovery restores public.ports from a data backup; this
-- file exists so the SCHEMA can be rebuilt without one.
--
-- Applied by scripts/db-rebuild.sh immediately after the remote baseline
-- creates public.ports. Idempotent.
-- ════════════════════════════════════════════════════════════════════════

insert into public.ports (locode, trade_name, country, zone) values

  ('ARROS', 'ARROS', 'AR', 'Unknown'),
  ('ARSLO', 'ARSLO', 'AR', 'ECSA'),
  ('BEANR', 'BEANR', 'BE', 'Unknown'),
  ('CNDDG', 'CNDDG', 'CN', 'Unknown'),
  ('CNDLC', 'CNDLC', 'CN', 'F.EAST'),
  ('CNRIZ', 'CNRIZ', 'CN', 'Unknown'),
  ('CNTGS', 'CNTGS', 'CN', 'Unknown'),
  ('CYFAM', 'CYFAM', 'CY', 'Unknown'),
  ('CYLCA', 'CYLCA', 'CY', 'E.MED'),
  ('DZAAE', 'DZAAE', 'DZ', 'Unknown'),
  ('DZALG', 'DZALG', 'DZ', 'W.MED'),
  ('DZBJA', 'DZBJA', 'DZ', 'Unknown'),
  ('DZORN', 'DZORN', 'DZ', 'Unknown'),
  ('DZSKI', 'DZSKI', 'DZ', 'Unknown'),
  ('EGALY', 'EGALY', 'EG', 'E.MED'),
  ('EGDAM', 'EGDAM', 'EG', 'Unknown'),
  ('EGDKH', 'EGDKH', 'EG', 'Unknown'),
  ('EGPSD', 'EGPSD', 'EG', 'Unknown'),
  ('EGSGA', 'EGSGA', 'EG', 'Unknown'),
  ('EGSOK', 'EGSOK', 'EG', 'Unknown'),
  ('ESALI', 'ESALI', 'ES', 'Unknown'),
  ('ESAVI', 'ESAVI', 'ES', 'Unknown'),
  ('ESBCN', 'ESBCN', 'ES', 'Unknown'),
  ('ESCAS', 'ESCAS', 'ES', 'Unknown'),
  ('ESFRO', 'ESFRO', 'ES', 'Unknown'),
  ('ESGIJ', 'ESGIJ', 'ES', 'Unknown'),
  ('ESLCG', 'ESLCG', 'ES', 'Unknown'),
  ('ESSAG', 'ESSAG', 'ES', 'Unknown'),
  ('ESSAN', 'ESSAN', 'ES', 'NCONT'),
  ('ESTRG', 'ESTRG', 'ES', 'W.MED'),
  ('GRANI', 'GRANI', 'GR', 'E.MED'),
  ('GRKVA', 'GRKVA', 'GR', 'Unknown'),
  ('GRPIR', 'GRPIR', 'GR', 'E.MED'),
  ('GRRET', 'GRRET', 'GR', 'Unknown'),
  ('GRSKG', 'GRSKG', 'GR', 'Unknown'),
  ('GRVOL', 'GRVOL', 'GR', 'Unknown'),
  ('INCCU', 'INCCU', 'IN', 'Unknown'),
  ('INDAH', 'INDAH', 'IN', 'Unknown'),
  ('INGGV', 'INGGV', 'IN', 'Unknown'),
  ('INHZA', 'INHZA', 'IN', 'Unknown'),
  ('INIXE', 'INIXE', 'IN', 'Unknown'),
  ('INIXY', 'INIXY', 'IN', 'Unknown'),
  ('INMAA', 'INMAA', 'IN', 'ECI'),
  ('INMED', 'INMED', 'IN', 'WCI'),
  ('INVTZ', 'INVTZ', 'IN', 'Unknown'),
  ('ITANX', 'ITANX', 'IT', 'Unknown'),
  ('ITBDS', 'ITBDS', 'IT', 'Unknown'),
  ('ITBRI', 'ITBRI', 'IT', 'Unknown'),
  ('ITCHI', 'ITCHI', 'IT', 'Unknown'),
  ('ITCIV', 'ITCIV', 'IT', 'Unknown'),
  ('ITGOA', 'ITGOA', 'IT', 'Unknown'),
  ('ITMNF', 'ITMNF', 'IT', 'Unknown'),
  ('ITNAP', 'ITNAP', 'IT', 'Unknown'),
  ('ITOLB', 'ITOLB', 'IT', 'W.MED'),
  ('ITPMA', 'ITPMA', 'IT', 'Unknown'),
  ('ITPNG', 'ITPNG', 'IT', 'Unknown'),
  ('ITQOS', 'ITQOS', 'IT', 'Unknown'),
  ('ITRAN', 'ITRAN', 'IT', 'C.MED'),
  ('ITSAL', 'ITSAL', 'IT', 'Unknown'),
  ('ITSVN', 'ITSVN', 'IT', 'Unknown'),
  ('ITTAR', 'ITTAR', 'IT', 'Unknown'),
  ('KWSWK', 'KWSWK', 'KW', 'AG'),
  ('LBBEY', 'LBBEY', 'LB', 'E.MED'),
  ('LBKYE', 'LBKYE', 'LB', 'Unknown'),
  ('LBSAI', 'LBSAI', 'LB', 'Unknown'),
  ('LYBGN', 'LYBGN', 'LY', 'Unknown'),
  ('LYMIS', 'LYMIS', 'LY', 'C.MED'),
  ('LYTIP', 'LYTIP', 'LY', 'Unknown'),
  ('LYTOB', 'LYTOB', 'LY', 'Unknown'),
  ('MAAGA', 'MAAGA', 'MA', 'Unknown'),
  ('MACAS', 'MACAS', 'MA', 'W.MED'),
  ('MAJLF', 'MAJLF', 'MA', 'Unknown'),
  ('MANDR', 'MANDR', 'MA', 'W.MED'),
  ('MASFI', 'MASFI', 'MA', 'Unknown'),
  ('MATNG', 'MATNG', 'MA', 'Unknown'),
  ('NGAPP', 'NGAPP', 'NG', 'Unknown'),
  ('NGLOS', 'NGLOS', 'NG', 'WCAF'),
  ('NGONN', 'NGONN', 'NG', 'Unknown'),
  ('NGPHC', 'NGPHC', 'NG', 'Unknown'),
  ('NLRTM', 'NLRTM', 'NL', 'NCONT'),
  ('RUKVZ', 'RUKVZ', 'RU', 'Unknown'),
  ('RUNOI', 'RUNOI', 'RU', 'B.SEA'),
  ('RUROV', 'RUROV', 'RU', 'Unknown'),
  ('RUTMK', 'RUTMK', 'RU', 'Unknown'),
  ('RUTMN', 'RUTMN', 'RU', 'Unknown'),
  ('RUTUA', 'RUTUA', 'RU', 'Unknown'),
  ('SAGIZ', 'SAGIZ', 'SA', 'Unknown'),
  ('SAJED', 'SAJED', 'SA', 'R.SEA'),
  ('SAKAC', 'SAKAC', 'SA', 'Unknown'),
  ('SAYAN', 'SAYAN', 'SA', 'Unknown'),
  ('SYBAN', 'SYBAN', 'SY', 'Unknown'),
  ('SYLTK', 'SYLTK', 'SY', 'E.MED'),
  ('SYTAR', 'SYTAR', 'SY', 'Unknown'),
  ('TNBIZ', 'TNBIZ', 'TN', 'Unknown'),
  ('TNGAE', 'TNGAE', 'TN', 'Unknown'),
  ('TNSFA', 'TNSFA', 'TN', 'Unknown'),
  ('TNSUS', 'TNSUS', 'TN', 'Unknown'),
  ('TNTUN', 'TNTUN', 'TN', 'C.MED'),
  ('TRALI', 'TRALI', 'TR', 'Unknown'),
  ('TRBAR', 'TRBAR', 'TR', 'Unknown'),
  ('TRBDM', 'TRBDM', 'TR', 'Unknown'),
  ('TRERE', 'TRERE', 'TR', 'Unknown'),
  ('TRFAT', 'TRFAT', 'TR', 'Unknown'),
  ('TRGEM', 'TRGEM', 'TR', 'Unknown'),
  ('TRISK', 'TRISK', 'TR', 'Unknown'),
  ('TRIST', 'TRIST', 'TR', 'Unknown'),
  ('TRIZM', 'TRIZM', 'TR', 'E.MED'),
  ('TRIZT', 'TRIZT', 'TR', 'E.MED'),
  ('TRMAR', 'TRMAR', 'TR', 'Unknown'),
  ('TRMER', 'TRMER', 'TR', 'E.MED'),
  ('TRSSX', 'TRSSX', 'TR', 'B.SEA'),
  ('TRTEK', 'TRTEK', 'TR', 'Unknown'),
  ('TRTZX', 'TRTZX', 'TR', 'Unknown'),
  ('UAILK', 'UAILK', 'UA', 'Unknown'),
  ('UAIZM', 'UAIZM', 'UA', 'Unknown'),
  ('UAODS', 'UAODS', 'UA', 'B.SEA'),
  ('UAREN', 'UAREN', 'UA', 'Unknown'),
  ('UAYUZ', 'UAYUZ', 'UA', 'Unknown')
on conflict (locode) do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.ports;
  raise notice 'reference ports present: %', n;
end $$;
