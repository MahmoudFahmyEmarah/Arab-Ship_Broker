-- ── Enums ─────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE public.zone_enum AS ENUM (
    'B.SEA','E.MED','W.MED','C.MED','ADRIATIC',
    'R.SEA','AG','A.SEA','WCAF','ECAF',
    'NCONT','CARIB','F.EAST','ECI','Unknown'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.port_type_enum AS ENUM ('Sea Port','River Port','Sea/River');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.cargo_type_v2_enum AS ENUM ('Dry Bulk','Break Bulk');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.imsbc_category_enum AS ENUM ('Cat_A','Cat_B','Cat_C','DG','Non_DG');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE public.answer_type_enum AS ENUM ('boolean','number','text','select','multi_select');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── ports ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.ports (
  locode       TEXT PRIMARY KEY,
  trade_name   TEXT NOT NULL,
  country      TEXT NOT NULL,
  zone         public.zone_enum NOT NULL,
  port_type    public.port_type_enum NOT NULL DEFAULT 'Sea Port',
  latitude     NUMERIC(9,6),
  longitude    NUMERIC(9,6),
  notes        TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  is_verified  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ports_trade_name ON public.ports USING GIN (to_tsvector('english', trade_name));
CREATE INDEX IF NOT EXISTS idx_ports_zone ON public.ports (zone);
CREATE INDEX IF NOT EXISTS idx_ports_country ON public.ports (country);

ALTER TABLE public.ports ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read verified active ports
DROP POLICY IF EXISTS "Authenticated read ports" ON public.ports;
CREATE POLICY "Authenticated read ports"
  ON public.ports FOR SELECT TO authenticated
  USING (is_active = TRUE AND is_verified = TRUE);

-- Admins can manage ports
DROP POLICY IF EXISTS "Admins manage ports" ON public.ports;
CREATE POLICY "Admins manage ports"
  ON public.ports FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

GRANT SELECT ON public.ports TO authenticated, anon;
GRANT ALL ON public.ports TO service_role;

-- ── commodities ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.commodities (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name   TEXT NOT NULL UNIQUE,
  display_aliases  TEXT[],
  cargo_type       public.cargo_type_v2_enum NOT NULL,
  imsbc_category   public.imsbc_category_enum NOT NULL,
  is_dg            BOOLEAN NOT NULL DEFAULT FALSE,
  is_grain         BOOLEAN NOT NULL DEFAULT FALSE,
  default_sf_m3t   NUMERIC(5,2),
  un_number        TEXT,
  imo_class        TEXT,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order       SMALLINT NOT NULL DEFAULT 100,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_commodities_updated_at ON public.commodities;
CREATE TRIGGER trg_commodities_updated_at
  BEFORE UPDATE ON public.commodities
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_commodities_active ON public.commodities (is_active, sort_order);

ALTER TABLE public.commodities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read commodities" ON public.commodities;
CREATE POLICY "Authenticated read commodities"
  ON public.commodities FOR SELECT TO authenticated
  USING (is_active = TRUE);

DROP POLICY IF EXISTS "Admins manage commodities" ON public.commodities;
CREATE POLICY "Admins manage commodities"
  ON public.commodities FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

GRANT SELECT ON public.commodities TO authenticated, anon;
GRANT ALL ON public.commodities TO service_role;

-- ── safety_questions ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.safety_questions (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_key              TEXT NOT NULL UNIQUE,
  question_text             TEXT NOT NULL,
  answer_type               public.answer_type_enum NOT NULL,
  select_options            TEXT[],
  applies_to_cargo_type     public.cargo_type_v2_enum[],
  applies_to_categories     public.imsbc_category_enum[],
  is_required               BOOLEAN NOT NULL DEFAULT FALSE,
  is_matchmaking_field      BOOLEAN NOT NULL DEFAULT FALSE,
  matchmaking_column        TEXT,
  section_label             TEXT,
  help_text                 TEXT,
  is_active                 BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order                SMALLINT NOT NULL DEFAULT 100,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_safety_questions_updated_at ON public.safety_questions;
CREATE TRIGGER trg_safety_questions_updated_at
  BEFORE UPDATE ON public.safety_questions
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_sq_active ON public.safety_questions (is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_sq_cargo_type ON public.safety_questions USING GIN (applies_to_cargo_type);
CREATE INDEX IF NOT EXISTS idx_sq_categories ON public.safety_questions USING GIN (applies_to_categories);

ALTER TABLE public.safety_questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read safety questions" ON public.safety_questions;
CREATE POLICY "Authenticated read safety questions"
  ON public.safety_questions FOR SELECT TO authenticated
  USING (is_active = TRUE);

DROP POLICY IF EXISTS "Admins manage safety questions" ON public.safety_questions;
CREATE POLICY "Admins manage safety questions"
  ON public.safety_questions FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

GRANT SELECT ON public.safety_questions TO authenticated;
GRANT ALL ON public.safety_questions TO service_role;

-- ── Seed: essential commodities ────────────────────────────────
-- Add the most common dry bulk commodities so the form works immediately.
-- Expand via admin UI — no code change needed.

INSERT INTO public.commodities (canonical_name, cargo_type, imsbc_category, is_dg, is_grain, default_sf_m3t, sort_order)
VALUES
  ('Grain (Wheat)',       'Dry Bulk', 'Cat_C', false, true,  47.0,  10),
  ('Grain (Corn/Maize)',  'Dry Bulk', 'Cat_C', false, true,  44.0,  11),
  ('Grain (Barley)',      'Dry Bulk', 'Cat_C', false, true,  48.0,  12),
  ('Grain (Soybean)',     'Dry Bulk', 'Cat_C', false, true,  36.0,  13),
  ('Phosphate Rock',      'Dry Bulk', 'Cat_C', false, false, 29.0,  20),
  ('Clinker',             'Dry Bulk', 'Cat_C', false, false, 28.0,  21),
  ('Coal',                'Dry Bulk', 'Cat_C', false, false, 48.0,  30),
  ('Iron Ore',            'Dry Bulk', 'Cat_C', false, false, 19.0,  31),
  ('Salt',                'Dry Bulk', 'Cat_C', false, false, 32.0,  40),
  ('Urea',                'Dry Bulk', 'Cat_C', false, false, 38.0,  50),
  ('DAP / MAP',           'Dry Bulk', 'Cat_C', false, false, 32.0,  51),
  ('Steel Products',      'Break Bulk', 'Non_DG', false, false, null, 60),
  ('Timber / Lumber',     'Break Bulk', 'Non_DG', false, false, null, 61),
  ('Project Cargo',       'Break Bulk', 'Non_DG', false, false, null, 70)
ON CONFLICT (canonical_name) DO NOTHING;

-- ── Seed: essential safety questions ──────────────────────────
INSERT INTO public.safety_questions
  (question_key, question_text, answer_type, is_required, is_matchmaking_field, matchmaking_column, section_label, sort_order, applies_to_cargo_type, applies_to_categories)
VALUES
  ('requires_geared',   'Does this cargo require a geared vessel?',          'boolean', false, true,  'requires_geared',   'Vessel requirements', 10,
   ARRAY['Dry Bulk','Break Bulk']::public.cargo_type_v2_enum[],
   ARRAY['Cat_A','Cat_B','Cat_C','DG','Non_DG']::public.imsbc_category_enum[]),

  ('max_vessel_age',    'Maximum vessel age allowed (years)?',                'number',  false, true,  'max_vessel_age_yr', 'Vessel requirements', 20,
   ARRAY['Dry Bulk','Break Bulk']::public.cargo_type_v2_enum[],
   ARRAY['Cat_A','Cat_B','Cat_C','DG','Non_DG']::public.imsbc_category_enum[]),

  ('max_draft',         'Maximum vessel draft (m)?',                          'number',  false, true,  'max_draft_m',       'Vessel requirements', 30,
   ARRAY['Dry Bulk','Break Bulk']::public.cargo_type_v2_enum[],
   ARRAY['Cat_A','Cat_B','Cat_C','DG','Non_DG']::public.imsbc_category_enum[]),

  ('max_loa',           'Maximum LOA (m)?',                                   'number',  false, true,  'max_loa_m',         'Vessel requirements', 40,
   ARRAY['Dry Bulk','Break Bulk']::public.cargo_type_v2_enum[],
   ARRAY['Cat_A','Cat_B','Cat_C','DG','Non_DG']::public.imsbc_category_enum[]),

  ('grain_cert',        'Does this cargo require grain-certified holds?',     'boolean', false, false, null,                'Safety', 50,
   ARRAY['Dry Bulk']::public.cargo_type_v2_enum[],
   ARRAY['Cat_C']::public.imsbc_category_enum[]),

  ('loading_method',    'What is the loading method?',                        'select',  false, false, null,                'Logistics', 60,
   ARRAY['Dry Bulk']::public.cargo_type_v2_enum[],
   ARRAY['Cat_A','Cat_B','Cat_C']::public.imsbc_category_enum[]),

  ('special_notes',     'Any special port restrictions or cargo notes?',      'text',    false, false, null,                'Logistics', 70,
   ARRAY['Dry Bulk','Break Bulk']::public.cargo_type_v2_enum[],
   ARRAY['Cat_A','Cat_B','Cat_C','DG','Non_DG']::public.imsbc_category_enum[])
ON CONFLICT (question_key) DO NOTHING;

-- Set select options for loading_method
UPDATE public.safety_questions
SET select_options = ARRAY['Grab','Conveyor','Spout','Bucket Elevator','Pneumatic']
WHERE question_key = 'loading_method';

-- ── Seed: Core 25 Hub Ports ──────────────────────────────────
-- Populating major regional hubs to enable matchmaking.
-- Verified ports are immediately available in autocomplete.

INSERT INTO public.ports (locode, trade_name, country, zone, port_type, notes) VALUES
  ('UA ODS', 'Odessa',          'Ukraine',      'B.SEA', 'Sea Port',   'Main Ukrainian export grain port'),
  ('UA ILK', 'Chornomorsk',     'Ukraine',      'B.SEA', 'Sea Port',   'Former Ilichevsk, bulk terminal'),
  ('UA YUZ', 'Pivdennyi',       'Ukraine',      'B.SEA', 'Sea Port',   'Former Yuzhne, large grain terminal'),
  ('UA IZM', 'Izmail',          'Ukraine',      'B.SEA', 'River Port', 'Danube river port. Sulina canal access'),
  ('RO CND', 'Constanta',       'Romania',      'B.SEA', 'Sea Port',   'Largest Black Sea port. Main grain hub'),
  ('BG VAR', 'Varna',           'Bulgaria',     'B.SEA', 'Sea Port',   'Main Bulgarian Black Sea port'),
  ('RU NOI', 'Novorossiysk',    'Russia',       'B.SEA', 'Sea Port',   'Largest Russian Black Sea port'),
  ('TR ISK', 'Iskenderun',      'Turkey',       'E.MED', 'Sea Port',   'NE Mediterranean, steel hub'),
  ('TR MRA', 'Marmara Adasi',   'Turkey',       'E.MED', 'Sea Port',   'Marmara Sea island port'),
  ('TR MER', 'Mersin',          'Turkey',       'E.MED', 'Sea Port',   'South Turkey, major port'),
  ('EG ALY', 'Alexandria',      'Egypt',        'E.MED', 'Sea Port',   'Largest Egyptian port'),
  ('EG DAM', 'Damietta',        'Egypt',        'E.MED', 'Sea Port',   'Nile Delta, grain/container'),
  ('EG PSD', 'Port Said',       'Egypt',        'E.MED', 'Sea Port',   'Suez Canal entrance'),
  ('SY LTK', 'Lattakia',        'Syria',        'E.MED', 'Sea Port',   'Main Syrian port'),
  ('JO AQB', 'Aqaba',           'Jordan',       'R.SEA', 'Sea Port',   'Jordan''s only sea port'),
  ('AE JEA', 'Jebel Ali',       'UAE',          'AG',    'Sea Port',   'Largest port in Middle East'),
  ('GR KLM', 'Kalamaki',        'Greece',       'E.MED', 'Sea Port',   'Near Piraeus, bulk terminal'),
  ('GR FLS', 'Eleusis',         'Greece',       'E.MED', 'Sea Port',   'Near Athens, steel/scrap hub'),
  ('IT RAN', 'Ravenna',         'Italy',        'ADRIATIC', 'Sea Port','NE Italy, Adriatic'),
  ('TN BIZ', 'Bizerte',         'Tunisia',      'E.MED', 'Sea Port',   'Northern Tunisia'),
  ('MA CAS', 'Casablanca',      'Morocco',      'W.MED', 'Sea Port',   'Morocco main port'),
  ('GH TEM', 'Tema',            'Ghana',        'WCAF',  'Sea Port',   'West Africa main port'),
  ('LY BEN', 'Benghazi',        'Libya',        'C.MED', 'Sea Port',   'East Libya'),
  ('SA KAC', 'King Abdullah Port','Saudi Arabia','R.SEA', 'Sea Port',  'Red Sea port, near Jeddah'),
  ('TR ERE', 'Eregli (Kdz)',    'Turkey',       'B.SEA', 'Sea Port',   'Kdz. Eregli, Black Sea. Steel hub.')
ON CONFLICT (locode) DO NOTHING;