-- voyage_settings (Voyage Economics, Stream S, 3 Oct 2026).
--
-- The Voyage estimator's assumptions as one app_settings row (read by every
-- member, written by admins on /admin/voyage-data). Defaults are the owner's
-- figures from the 3 Oct brief; nothing here is a constant in code.
-- Contract: PLAN-voyage-economics.md §4.3.

insert into public.app_settings (key, value, updated_at)
values ('voyage_settings', $json${
  "speeds": {"ladenKn": 12.5, "ballastKn": 13.0},
  "seaMargin": {"defaultPct": 5, "byLane": {}, "bySeason": {}},
  "portTimeDays": {"loadDefault": 1.5, "dischDefault": 1.5, "idleSharePct": 20},
  "anchorageDaysDefault": 0,
  "suez": {"transitDays": 1, "anchorageDays": 0.5, "nm": 100},
  "opex": {"crewUsdDay": 1450, "maintenanceUsdDay": 800},
  "classMultipliers": {"A": 2.2, "B": 1.5, "C": 1.0},
  "eca": {"fuelProductKey": "LSMGO"},
  "fuelFallback": {"VLSFO": 585, "LSMGO": 725, "HSFO380": 450, "MGO05": 700}
}$json$::jsonb, now())
on conflict (key) do nothing;
