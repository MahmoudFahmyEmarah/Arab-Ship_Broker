-- ============================================================
-- ARAB SHIPBROKER — DEMO SEED DATA
-- Sample announcements, fuel prices, commodities
-- Safe to run multiple times (ON CONFLICT DO NOTHING)
-- ============================================================

-- ── Fuel prices (a few sponsors) ─────────────────────────────
INSERT INTO fuel_prices (sponsor_name, port_area, vlsfo_usd_mt, lsmgo_usd_mt, mgo_usd_mt, vlsfo_direction, lsmgo_direction, mgo_direction, is_active)
VALUES
  ('O Bunkering',     'Sohar / Salalah',   582, 648, 820, 'up',   'flat', 'up',   true),
  ('Gulf Marine Fuels','Fujairah',         595, 661, NULL, 'up',  'up',   NULL,   true),
  ('Red Sea Bunkers', 'Jeddah / Yanbu',    588, NULL, NULL, 'flat', NULL,  NULL,   true),
  ('Levant Bunker Co.', 'Beirut / Lattakia', 612, NULL, NULL, 'flat', NULL, NULL,  true)
ON CONFLICT DO NOTHING;

-- ── Sample announcements ─────────────────────────────────────
INSERT INTO announcements (title, category, link_url, link_label, target_tiers, active)
VALUES
  ('Port DAs for Jebel Ali updated', 'port_da', NULL, 'View →', ARRAY['T1','T2','T3','T4'], true),
  ('Bunker prices updated · 06:00 UTC', 'bunker', NULL, NULL, ARRAY['T1','T2','T3','T4'], true),
  ('Platform v0.2 — new Cargo Market layout', 'version', NULL, 'Changelog →', ARRAY['T1','T2','T3','T4'], true),
  ('Reminder: enable 2FA on your account', 'security', NULL, 'Set up →', ARRAY['T1','T2','T3','T4'], true)
ON CONFLICT DO NOTHING;

-- ── Top commodities ──────────────────────────────────────────
INSERT INTO commodities (canonical_name, cargo_type, imsbc_category, is_grain, default_sf_m3t, category_label)
VALUES
  ('Wheat',           'Dry Bulk',   'Cat_C', true,  1.30, 'Grains & Oilseeds'),
  ('Corn',            'Dry Bulk',   'Cat_C', true,  1.40, 'Grains & Oilseeds'),
  ('Barley',          'Dry Bulk',   'Cat_C', true,  1.50, 'Grains & Oilseeds'),
  ('Soybeans',        'Dry Bulk',   'Cat_C', true,  1.35, 'Grains & Oilseeds'),
  ('Sunflower Seeds', 'Dry Bulk',   'Cat_C', true,  2.40, 'Grains & Oilseeds'),
  ('Rice',            'Dry Bulk',   'Cat_C', true,  1.65, 'Grains & Oilseeds'),
  ('Fertilisers',     'Dry Bulk',   'Cat_B', false, 1.00, 'Fertilisers'),
  ('Urea',            'Dry Bulk',   'Cat_B', false, 0.90, 'Fertilisers'),
  ('Ammonium Nitrate','Dry Bulk',   'Cat_B', false, 1.10, 'Fertilisers'),
  ('Cement',          'Dry Bulk',   'Cat_A', false, 0.70, 'Cement & Clinker'),
  ('Clinker',         'Dry Bulk',   'Cat_A', false, 0.75, 'Cement & Clinker'),
  ('Coal',            'Dry Bulk',   'Cat_B', false, 1.15, 'Coal & Carbon'),
  ('Petcoke',         'Dry Bulk',   'Cat_B', false, 1.05, 'Coal & Carbon'),
  ('Anthracite',      'Dry Bulk',   'Cat_B', false, 1.10, 'Coal & Carbon'),
  ('Salt',            'Dry Bulk',   'Cat_C', false, 0.85, 'Salt & Minerals'),
  ('Rock Phosphate',  'Dry Bulk',   'Cat_C', false, 0.90, 'Salt & Minerals'),
  ('Minerals',        'Dry Bulk',   'Cat_C', false, 0.80, 'Salt & Minerals'),
  ('Silica Sand',     'Dry Bulk',   'Cat_C', false, 0.65, 'Salt & Minerals'),
  ('Dolomite',        'Dry Bulk',   'Cat_C', false, 0.70, 'Salt & Minerals'),
  ('Marble Chips',    'Dry Bulk',   'Cat_C', false, 0.60, 'Salt & Minerals'),
  ('Soda Ash',        'Dry Bulk',   'Cat_B', false, 1.05, 'Chemicals & Industrial'),
  ('Copper Concentrates','Dry Bulk', 'Cat_A', false, 0.40, 'Chemicals & Industrial'),
  ('Calcium Chloride','Break Bulk', 'Non_DG', false, NULL, 'Chemicals & Industrial'),
  ('Scrap',           'Dry Bulk',   'Cat_C', false, 0.45, 'Steel Products'),
  ('Slag',            'Dry Bulk',   'Cat_C', false, 0.55, 'Steel Products'),
  ('GBFS',            'Dry Bulk',   'Cat_C', false, 0.55, 'Steel Products'),
  ('Steel Coils',     'Break Bulk', 'Non_DG', false, NULL, 'Steel Products'),
  ('Steel Sheets',    'Break Bulk', 'Non_DG', false, NULL, 'Steel Products'),
  ('Steel Plates',    'Break Bulk', 'Non_DG', false, NULL, 'Steel Products'),
  ('Steel Rebars',    'Break Bulk', 'Non_DG', false, NULL, 'Steel Products'),
  ('Wire Rod in Coils','Break Bulk', 'Non_DG', false, NULL, 'Steel Products'),
  ('Sugar',           'Break Bulk', 'Non_DG', false, NULL, 'General & Bagged Cargo'),
  ('General Cargo',   'Break Bulk', 'Non_DG', false, NULL, 'General & Bagged Cargo'),
  ('Marble Blocks',   'Break Bulk', 'Non_DG', false, NULL, 'Salt & Minerals'),
  ('Feldspar',        'Break Bulk', 'Non_DG', false, NULL, 'Salt & Minerals'),
  ('Logs',            'Break Bulk', 'Non_DG', false, NULL, 'Wood & Forest Products')
ON CONFLICT (canonical_name) DO NOTHING;

-- Update category_label on existing rows (in case they were inserted without it)
UPDATE commodities SET category_label = 'Grains & Oilseeds'  WHERE is_grain = true AND category_label IS NULL;
