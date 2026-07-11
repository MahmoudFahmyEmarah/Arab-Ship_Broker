-- Open-position intelligence on queued vessels: where she's open, where she
-- wants to go, and when the position was posted — drives location-aware matching.
alter table public.vessel_review_queue add column if not exists open_port    text;
alter table public.vessel_review_queue add column if not exists open_country text;
alter table public.vessel_review_queue add column if not exists open_zone    text;
alter table public.vessel_review_queue add column if not exists direction    text;
alter table public.vessel_review_queue add column if not exists dest_zones   text[];
alter table public.vessel_review_queue add column if not exists posted_at    timestamptz;
