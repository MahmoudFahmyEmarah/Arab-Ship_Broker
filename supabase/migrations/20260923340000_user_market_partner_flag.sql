-- Restore the market-partner entitlement flag expected by the portal and
-- Fixture Room tier gates. The historical pre-baseline migration contained
-- this field, but the active remote baseline did not carry it forward.
--
-- The profile update guard introduced by 20260923330000 is deliberately an
-- allow-list, so authenticated users cannot change this new flag. Only
-- service-owned administration may grant or revoke the entitlement.

alter table public.users
  add column if not exists is_market_partner boolean not null default false;

comment on column public.users.is_market_partner is
  'Service-managed entitlement: approved market partners receive subscriber-level feature access independently of subscription tier.';
