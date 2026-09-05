-- Group Mail: editable signature (05 Sep 2026)
-- The sign-off used to be hard-coded in the template. It now has a default in
-- Settings (groupmail_config.signature) and every campaign stores the copy
-- the sender edited in the form (groupmail_campaign.signature), so whoever
-- sends a circular signs it as themselves.
alter table public.groupmail_config add column if not exists signature jsonb;
alter table public.groupmail_campaign add column if not exists signature jsonb;
comment on column public.groupmail_config.signature is 'Default circular signature {closing,name,role,phone,email,site}; editable per campaign.';
comment on column public.groupmail_campaign.signature is 'Signature used for this campaign (snapshot of the form at send/schedule time).';
