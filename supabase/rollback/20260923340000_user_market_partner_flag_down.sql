-- Roll back the additive market-partner entitlement field.
-- Apply before the privilege-boundary DOWN so its strict allow-list remains
-- in force until the service-owned field has been removed.
alter table public.users
  drop column if exists is_market_partner;
