-- DOWN for 20261017100000: removes the binding read. Plain SQL; safe at any time (no data is involved).
-- Deploy order: roll the application back to a build without the version-aware store (renderer recap-pdf/2 only)
-- before running this, or a pending/failed PDF retry will report that its record could not be read.
set local lock_timeout = '5s';

drop function if exists public.fixture_recap_pdf_binding(uuid);
