-- Align DB enums to the 05-Jul-2026 CargoMap workbook (the source of truth).
-- The workbook carries values the enums were missing, which would otherwise
-- crash the commit (vessel type / port zone) or drop data (cargo priority):
--   • VESSEL_TYPE uses "Cargo Ship" (two-value model) — enum only had General Cargo/Other
--   • PORTS.ZONE includes "GLAKES" (Great Lakes)
--   • CARGO.PRIORITY includes "CRITICAL" and "MONITOR"
-- All additive (add value) → safe, non-breaking.
alter type public.vessel_type_enum    add value if not exists 'Cargo Ship';
alter type public.zone_enum           add value if not exists 'GLAKES';
alter type public.cargo_priority_enum add value if not exists 'CRITICAL' before 'HIGH';
alter type public.cargo_priority_enum add value if not exists 'MONITOR'  before 'CLOSED';
