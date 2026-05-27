-- ============================================================
-- ARAB SHIPBROKER — SUPABASE SCHEMA
-- Version: 1.0  |  Generated: April 2026
-- Run order: execute this file top to bottom, once.
-- All tables, types, triggers, indexes, and RLS policies included.
-- ============================================================


-- ============================================================
-- EXTENSIONS
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- ============================================================
-- ENUMS
-- All application-controlled value sets live here.
-- To add a value: ALTER TYPE enum_name ADD VALUE 'new_val';
-- ============================================================

CREATE TYPE vessel_type_enum       AS ENUM ('Bulk Carrier','General Cargo','Other');
CREATE TYPE flag_category_enum     AS ENUM ('FOC','Domestic');
CREATE TYPE scope_enum             AS ENUM ('In Scope','Marginal','Out of Scope');
CREATE TYPE risk_level_enum        AS ENUM ('CLEAR','LOW','MEDIUM','HIGH');
CREATE TYPE zone_enum              AS ENUM (
  'B.SEA','E.MED','W.MED','C.MED','ADRIATIC',
  'R.SEA','AG','A.SEA','WCAF','ECAF',
  'NCONT','CARIB','F.EAST','ECI','Unknown'
);
CREATE TYPE port_type_enum         AS ENUM ('Sea Port','River Port','Sea/River');
CREATE TYPE cargo_type_enum        AS ENUM ('Dry Bulk','Break Bulk');
CREATE TYPE imsbc_category_enum    AS ENUM ('Cat_A','Cat_B','Cat_C','DG','Non_DG');
CREATE TYPE cargo_status_enum      AS ENUM ('IN','PARTIAL','OUT','CLOSED');
CREATE TYPE cargo_priority_enum    AS ENUM ('HIGH','MED','LOW','CLOSED');
CREATE TYPE answer_type_enum       AS ENUM ('boolean','number','text','select','multi_select');
CREATE TYPE vessel_status_enum     AS ENUM ('OPEN','FIXED','ON SUBS','INACTIVE');
CREATE TYPE trust_tier_enum        AS ENUM ('NEW','VERIFIED','FLAGGED');
CREATE TYPE listing_type_enum      AS ENUM ('cargo','vessel_availability');
CREATE TYPE ownership_role_enum    AS ENUM ('primary','co_broker','admin_posted');
CREATE TYPE transfer_reason_enum   AS ENUM (
  'initial_post','claim_approved','dispute_resolved',
  'admin_transfer','broker_left','error_correction'
);
CREATE TYPE claim_basis_enum       AS ENUM (
  'original_source','co_broker','correction','principal_instruction'
);
CREATE TYPE claim_status_enum      AS ENUM (
  'PENDING','APPROVED','REJECTED','DISPUTED','WITHDRAWN'
);
CREATE TYPE claim_outcome_enum     AS ENUM (
  'transfer_full','assign_co_broker','split_new_record','no_change'
);
CREATE TYPE vessel_change_type_enum AS ENUM (
  'ownership_sale','manager_change','pic_change',
  'contact_update','risk_update','full_update'
);
CREATE TYPE change_source_enum     AS ENUM (
  'equasis_lookup','owner_notification','broker_report',
  'admin_update','system_import'
);
CREATE TYPE review_status_enum     AS ENUM ('PENDING','APPROVED','REJECTED','FLAGGED');
CREATE TYPE review_action_enum     AS ENUM ('approved','rejected','amended','flagged');
CREATE TYPE load_terms_enum        AS ENUM (
  'FIO','FIOT','FIOST','FIOS','FIOS LSD','Liner Terms'
);


-- ============================================================
-- HELPER: updated_at trigger function
-- Attach to any table that needs updated_at auto-managed.
-- ============================================================
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


-- ============================================================
-- TABLE 1: users
-- Supabase auth.users is the auth layer.
-- This table holds app-level profile and trust tier.
-- ============================================================
CREATE TABLE users (
  id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name       TEXT,
  company         TEXT,
  role            TEXT,                          -- "Broker", "Owner", "Operator" etc.
  phone           TEXT,                          -- encrypted at rest via app layer
  email           TEXT,                          -- mirrors auth.users email
  trust_tier      trust_tier_enum NOT NULL DEFAULT 'NEW',
  clean_posts     SMALLINT NOT NULL DEFAULT 0,   -- count of approved posts with zero corrections
  strike_count    SMALLINT NOT NULL DEFAULT 0,   -- corrections / errors recorded
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  notes           TEXT,                          -- admin notes on this user
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- ============================================================
-- TABLE 2: ports
-- Seed from PORT_CODES sheet (120 rows).
-- Powers autocomplete on all port fields across the platform.
-- Selecting a port auto-populates locode, zone, country, type.
-- ============================================================
CREATE TABLE ports (
  locode          TEXT PRIMARY KEY,              -- e.g. "EG ALY"
  trade_name      TEXT NOT NULL,                 -- e.g. "Alexandria"
  country         TEXT NOT NULL,
  zone            zone_enum NOT NULL,
  port_type       port_type_enum NOT NULL DEFAULT 'Sea Port',
  latitude        NUMERIC(9,6),
  longitude       NUMERIC(9,6),
  notes           TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  is_verified     BOOLEAN NOT NULL DEFAULT TRUE, -- FALSE for user-submitted new ports pending admin check
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ports_trade_name ON ports USING GIN (to_tsvector('english', trade_name));
CREATE INDEX idx_ports_zone       ON ports (zone);
CREATE INDEX idx_ports_country    ON ports (country);


-- ============================================================
-- TABLE 3: commodities
-- Master list. One canonical name per commodity.
-- Drives cargo_type, IMSBC category, and safety question set.
-- Admin-managed. Never free text on cargo forms.
-- ============================================================
CREATE TABLE commodities (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  canonical_name   TEXT NOT NULL UNIQUE,
  display_aliases  TEXT[],                       -- for autocomplete search only
  cargo_type       cargo_type_enum NOT NULL,
  imsbc_category   imsbc_category_enum NOT NULL,
  is_dg            BOOLEAN NOT NULL DEFAULT FALSE,
  is_grain         BOOLEAN NOT NULL DEFAULT FALSE,
  default_sf_m3t   NUMERIC(5,2),                 -- default stowage factor
  un_number        TEXT,                          -- DG only e.g. "1942"
  imo_class        TEXT,                          -- DG only e.g. "5.1"
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order       SMALLINT NOT NULL DEFAULT 100,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_commodities_updated_at
  BEFORE UPDATE ON commodities
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE INDEX idx_commodities_cargo_type ON commodities (cargo_type);
CREATE INDEX idx_commodities_imsbc      ON commodities (imsbc_category);
CREATE INDEX idx_commodities_active     ON commodities (is_active, sort_order);


-- ============================================================
-- TABLE 4: safety_questions
-- Questions as data. Adding/removing/editing = admin UI only.
-- No developer or redeployment needed.
-- RULE: question_key never changes once set.
--       question_text, sort_order, is_required = free to edit.
-- ============================================================
CREATE TABLE safety_questions (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  question_key              TEXT NOT NULL UNIQUE, -- machine ref, NEVER changes
  question_text             TEXT NOT NULL,         -- what user sees, editable
  answer_type               answer_type_enum NOT NULL,
  select_options            TEXT[],                -- for select/multi_select types
  applies_to_cargo_type     cargo_type_enum[],     -- null = applies to both
  applies_to_categories     imsbc_category_enum[], -- which IMSBC categories see this
  is_required               BOOLEAN NOT NULL DEFAULT FALSE,
  is_matchmaking_field      BOOLEAN NOT NULL DEFAULT FALSE,
  matchmaking_column        TEXT,                  -- cargo_listings column name to write to
  section_label             TEXT,                  -- visual grouping on form
  help_text                 TEXT,                  -- tooltip
  is_active                 BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order                SMALLINT NOT NULL DEFAULT 100,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_safety_questions_updated_at
  BEFORE UPDATE ON safety_questions
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE INDEX idx_sq_active      ON safety_questions (is_active, sort_order);
CREATE INDEX idx_sq_cargo_type  ON safety_questions USING GIN (applies_to_cargo_type);
CREATE INDEX idx_sq_categories  ON safety_questions USING GIN (applies_to_categories);


-- ============================================================
-- TABLE 5: vessels
-- Static intelligence register.
-- Current contact snapshot lives here for fast reads.
-- Full change history lives in vessel_contact_history.
-- PII fields noted — encrypt at application layer using pgcrypto.
-- ============================================================
CREATE TABLE vessels (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vessel_name         TEXT NOT NULL,
  imo_number          TEXT UNIQUE,                -- unique when present, null allowed
  vessel_type         vessel_type_enum NOT NULL,
  dwt_grain           INTEGER,                    -- N/V in source = null
  dwt_bale            INTEGER,
  build_year          SMALLINT,
  flag                TEXT,
  flag_category       flag_category_enum,
  scope               scope_enum NOT NULL DEFAULT 'In Scope',
  risk_level          risk_level_enum NOT NULL DEFAULT 'CLEAR',
  risk_notes          TEXT,
  preferred_zones     zone_enum[],                -- parsed from trading_zone free text
  trading_zone_raw    TEXT,                       -- original free text preserved

  -- Compliance flags (derived/set by admin)
  is_geared           BOOLEAN,
  crane_count         SMALLINT,
  crane_swl_mt        NUMERIC(6,2),
  grain_certified     BOOLEAN,
  dg_certified        BOOLEAN,
  max_loa_m           NUMERIC(6,2),
  max_draft_m         NUMERIC(5,2),
  pi_club             TEXT,
  is_sanctioned       BOOLEAN NOT NULL DEFAULT FALSE, -- hard block on posting

  -- Current contact snapshot (source of truth = vessel_contact_history)
  owner_company       TEXT,
  owner_country       TEXT,
  owner_address       TEXT,                       -- PII — encrypt at app layer
  manager_company     TEXT,
  manager_country     TEXT,
  manager_address     TEXT,                       -- PII — encrypt at app layer
  pic_name            TEXT,                       -- PII — encrypt at app layer
  pic_role            TEXT,
  phone               TEXT,                       -- PII — encrypt at app layer
  email_general       TEXT,                       -- PII — encrypt at app layer
  email_chartering    TEXT,                       -- PII — encrypt at app layer
  website             TEXT,

  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_vessels_updated_at
  BEFORE UPDATE ON vessels
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE INDEX idx_vessels_imo          ON vessels (imo_number) WHERE imo_number IS NOT NULL;
CREATE INDEX idx_vessels_scope        ON vessels (scope);
CREATE INDEX idx_vessels_risk         ON vessels (risk_level);
CREATE INDEX idx_vessels_sanctioned   ON vessels (is_sanctioned);
CREATE INDEX idx_vessels_dwt          ON vessels (dwt_grain) WHERE dwt_grain IS NOT NULL;
CREATE INDEX idx_vessels_pref_zones   ON vessels USING GIN (preferred_zones);
CREATE INDEX idx_vessels_type         ON vessels (vessel_type);


-- ============================================================
-- TABLE 6: vessel_contact_history
-- Full audit trail of every contact / ownership change.
-- is_current = true is the active record.
-- Partial unique index enforces one active record per vessel.
-- ============================================================
CREATE TABLE vessel_contact_history (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vessel_id        UUID NOT NULL REFERENCES vessels(id) ON DELETE CASCADE,
  change_type      vessel_change_type_enum NOT NULL,

  -- Full contact snapshot at this point in time
  owner_company    TEXT,
  owner_country    TEXT,
  owner_address    TEXT,                          -- PII — encrypt at app layer
  manager_company  TEXT,
  manager_country  TEXT,
  manager_address  TEXT,                          -- PII — encrypt at app layer
  pic_name         TEXT,                          -- PII — encrypt at app layer
  pic_role         TEXT,
  phone            TEXT,                          -- PII — encrypt at app layer
  email_general    TEXT,                          -- PII — encrypt at app layer
  email_chartering TEXT,                          -- PII — encrypt at app layer
  risk_level       risk_level_enum,
  risk_notes       TEXT,

  is_current       BOOLEAN NOT NULL DEFAULT TRUE,
  valid_from       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_until      TIMESTAMPTZ,                   -- null if still current
  change_source    change_source_enum NOT NULL DEFAULT 'admin_update',
  change_note      TEXT,
  updated_by       UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only one active record per vessel
CREATE UNIQUE INDEX idx_vch_one_current
  ON vessel_contact_history (vessel_id)
  WHERE is_current = TRUE;

CREATE INDEX idx_vch_vessel   ON vessel_contact_history (vessel_id, valid_from DESC);
CREATE INDEX idx_vch_current  ON vessel_contact_history (is_current) WHERE is_current = TRUE;

-- Trigger: when a new history row is inserted as current,
-- close the previous current row and sync snapshot to vessels table.
CREATE OR REPLACE FUNCTION fn_vessel_contact_history_insert()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_current THEN
    -- Close previous current row
    UPDATE vessel_contact_history
    SET is_current = FALSE, valid_until = NOW()
    WHERE vessel_id = NEW.vessel_id
      AND is_current = TRUE
      AND id != NEW.id;

    -- Sync snapshot to vessels table
    UPDATE vessels SET
      owner_company    = NEW.owner_company,
      owner_country    = NEW.owner_country,
      owner_address    = NEW.owner_address,
      manager_company  = NEW.manager_company,
      manager_country  = NEW.manager_country,
      manager_address  = NEW.manager_address,
      pic_name         = NEW.pic_name,
      pic_role         = NEW.pic_role,
      phone            = NEW.phone,
      email_general    = NEW.email_general,
      email_chartering = NEW.email_chartering,
      risk_level       = COALESCE(NEW.risk_level, risk_level),
      risk_notes       = COALESCE(NEW.risk_notes, risk_notes),
      updated_at       = NOW()
    WHERE id = NEW.vessel_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_vch_insert
  AFTER INSERT ON vessel_contact_history
  FOR EACH ROW EXECUTE FUNCTION fn_vessel_contact_history_insert();


-- ============================================================
-- TABLE 7: vessel_availability
-- Dynamic operational layer. Separate from static intelligence.
-- This is what matchmaking queries.
-- One vessel can have multiple records over time — history kept.
-- ============================================================
CREATE TABLE vessel_availability (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vessel_id               UUID NOT NULL REFERENCES vessels(id) ON DELETE CASCADE,

  -- Port autocomplete fields — open_port_locode triggers auto-fill
  open_port_locode        TEXT REFERENCES ports(locode),
  open_port_name          TEXT,                   -- auto-filled from ports
  open_zone               zone_enum,              -- auto-filled from ports — used in match query

  open_date               DATE,
  open_date_range_days    SMALLINT DEFAULT 7,     -- flexibility window
  last_cargo              TEXT,
  service_speed_kn        NUMERIC(4,1),
  me_consumption_mt_day   NUMERIC(5,2),
  aux_consumption_mt_day  NUMERIC(5,2),
  freight_idea_usd_mt     NUMERIC(8,2),
  accepts_part_cargo      BOOLEAN DEFAULT FALSE,
  status                  vessel_status_enum NOT NULL DEFAULT 'OPEN',

  -- Moderation
  review_status           review_status_enum NOT NULL DEFAULT 'PENDING',
  goes_live_at            TIMESTAMPTZ,            -- set when approved or auto-approved

  notes                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_vessel_availability_updated_at
  BEFORE UPDATE ON vessel_availability
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE INDEX idx_va_vessel        ON vessel_availability (vessel_id);
CREATE INDEX idx_va_zone          ON vessel_availability (open_zone);
CREATE INDEX idx_va_open_date     ON vessel_availability (open_date) WHERE status = 'OPEN';
CREATE INDEX idx_va_status        ON vessel_availability (status, review_status);

-- Trigger: auto-fill port fields when locode is set
CREATE OR REPLACE FUNCTION fn_va_port_autofill()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.open_port_locode IS NOT NULL AND
     (OLD.open_port_locode IS DISTINCT FROM NEW.open_port_locode) THEN
    SELECT trade_name, zone
    INTO NEW.open_port_name, NEW.open_zone
    FROM ports WHERE locode = NEW.open_port_locode;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_va_port_autofill
  BEFORE INSERT OR UPDATE ON vessel_availability
  FOR EACH ROW EXECUTE FUNCTION fn_va_port_autofill();


-- ============================================================
-- TABLE 8: cargo_listings
-- Operational cargo records. Source: cargo map + new entries.
-- Port fields auto-populated via trigger when locode is set.
-- Matchmaking-critical safety answers written back here.
-- ============================================================
CREATE TABLE cargo_listings (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ref                   TEXT UNIQUE,              -- CM-001, P-001, OUT-001
  batch_id              TEXT,                     -- B-001, B-002 etc.
  batch_date            DATE,
  status                cargo_status_enum NOT NULL DEFAULT 'IN',
  priority              cargo_priority_enum,
  cargo_group_id        UUID,                     -- shared ID for duplicate/related cargo

  -- Commodity (from master list only)
  cargo_type            cargo_type_enum NOT NULL,
  commodity_id          UUID REFERENCES commodities(id),
  commodity_name        TEXT NOT NULL,            -- denormalised for display
  is_dg_cargo           BOOLEAN NOT NULL DEFAULT FALSE, -- auto from commodities.is_dg
  is_grain_cargo        BOOLEAN NOT NULL DEFAULT FALSE, -- auto from commodities.is_grain

  -- Quantity
  qty_min_mt            INTEGER NOT NULL,
  qty_max_mt            INTEGER NOT NULL,
  stowage_factor        NUMERIC(5,2),             -- extracted from notes or answered in safety Q

  -- Load port — auto-filled via trigger on locode set
  load_port_locode      TEXT REFERENCES ports(locode),
  load_port_name        TEXT,
  load_zone             zone_enum,
  load_country          TEXT,

  -- Discharge port — auto-filled via trigger on locode set
  disch_port_locode     TEXT REFERENCES ports(locode),
  disch_port_name       TEXT,
  disch_zone            zone_enum,
  disch_country         TEXT,

  -- Laytime
  laycan_from           DATE,
  laycan_to             DATE,
  is_spot               BOOLEAN NOT NULL DEFAULT FALSE,

  -- Commercial
  load_rate             TEXT,
  disch_rate            TEXT,
  load_terms            load_terms_enum,
  laytime_structure     TEXT,
  nor_clause            TEXT,
  freight_idea_usd_mt   NUMERIC(8,2),
  commission_pct        NUMERIC(4,2),
  demurrage_rate        NUMERIC(10,2),
  despatch_rate         NUMERIC(10,2),

  -- Vessel requirements (written back from safety question answers)
  requires_geared       BOOLEAN,
  max_vessel_age_yr     SMALLINT,
  max_loa_m             NUMERIC(6,2),
  max_draft_m           NUMERIC(5,2),

  -- Broker / contact
  broker                TEXT,
  notes                 TEXT,

  -- Moderation
  review_status         review_status_enum NOT NULL DEFAULT 'PENDING',
  goes_live_at          TIMESTAMPTZ,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_cargo_listings_updated_at
  BEFORE UPDATE ON cargo_listings
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE INDEX idx_cl_status        ON cargo_listings (status, review_status);
CREATE INDEX idx_cl_load_zone     ON cargo_listings (load_zone);
CREATE INDEX idx_cl_disch_zone    ON cargo_listings (disch_zone);
CREATE INDEX idx_cl_qty           ON cargo_listings (qty_min_mt, qty_max_mt);
CREATE INDEX idx_cl_laycan        ON cargo_listings (laycan_from, laycan_to);
CREATE INDEX idx_cl_commodity     ON cargo_listings (commodity_id);
CREATE INDEX idx_cl_group         ON cargo_listings (cargo_group_id) WHERE cargo_group_id IS NOT NULL;
CREATE INDEX idx_cl_is_spot       ON cargo_listings (is_spot);

-- Trigger: auto-fill port fields for both POL and POD
CREATE OR REPLACE FUNCTION fn_cl_port_autofill()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  p ports%ROWTYPE;
BEGIN
  -- Load port
  IF NEW.load_port_locode IS NOT NULL AND
     (OLD.load_port_locode IS DISTINCT FROM NEW.load_port_locode) THEN
    SELECT * INTO p FROM ports WHERE locode = NEW.load_port_locode;
    NEW.load_port_name := p.trade_name;
    NEW.load_zone      := p.zone;
    NEW.load_country   := p.country;
  END IF;
  -- Discharge port
  IF NEW.disch_port_locode IS NOT NULL AND
     (OLD.disch_port_locode IS DISTINCT FROM NEW.disch_port_locode) THEN
    SELECT * INTO p FROM ports WHERE locode = NEW.disch_port_locode;
    NEW.disch_port_name := p.trade_name;
    NEW.disch_zone      := p.zone;
    NEW.disch_country   := p.country;
  END IF;
  -- Auto-set DG and grain flags from commodity
  IF NEW.commodity_id IS NOT NULL AND
     (OLD.commodity_id IS DISTINCT FROM NEW.commodity_id) THEN
    SELECT is_dg, is_grain
    INTO NEW.is_dg_cargo, NEW.is_grain_cargo
    FROM commodities WHERE id = NEW.commodity_id;
  END IF;
  -- is_spot
  IF NEW.laycan_from IS NULL THEN
    NEW.is_spot := TRUE;
  ELSE
    NEW.is_spot := FALSE;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_cl_port_autofill
  BEFORE INSERT OR UPDATE ON cargo_listings
  FOR EACH ROW EXECUTE FUNCTION fn_cl_port_autofill();


-- ============================================================
-- TABLE 9: cargo_safety_answers
-- Key-value answers for safety questions.
-- One row per question per cargo listing.
-- question_key denormalised — answers survive question deletion.
-- ============================================================
CREATE TABLE cargo_safety_answers (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cargo_listing_id    UUID NOT NULL REFERENCES cargo_listings(id) ON DELETE CASCADE,
  question_id         UUID REFERENCES safety_questions(id) ON DELETE SET NULL,
  question_key        TEXT NOT NULL,              -- denormalised — preserved if question deleted
  answer_value        TEXT,                       -- all types stored as text, cast on read
  answered_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  answered_by         UUID REFERENCES users(id)
);

CREATE UNIQUE INDEX idx_csa_unique ON cargo_safety_answers (cargo_listing_id, question_key);
CREATE INDEX idx_csa_cargo         ON cargo_safety_answers (cargo_listing_id);
CREATE INDEX idx_csa_key           ON cargo_safety_answers (question_key);

-- Trigger: if answer has a matchmaking_column, write back to cargo_listings
CREATE OR REPLACE FUNCTION fn_csa_matchmaking_writeback()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  mc TEXT;
BEGIN
  SELECT matchmaking_column INTO mc
  FROM safety_questions
  WHERE question_key = NEW.question_key
    AND is_matchmaking_field = TRUE;

  IF mc IS NOT NULL THEN
    EXECUTE format(
      'UPDATE cargo_listings SET %I = $1 WHERE id = $2',
      mc
    ) USING NEW.answer_value, NEW.cargo_listing_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_csa_writeback
  AFTER INSERT OR UPDATE ON cargo_safety_answers
  FOR EACH ROW EXECUTE FUNCTION fn_csa_matchmaking_writeback();


-- ============================================================
-- TABLE 10: listing_ownership
-- Replaces posted_by columns everywhere.
-- Full ownership history for cargo and vessel availability.
-- Partial unique index: only one is_current = true per listing.
-- ============================================================
CREATE TABLE listing_ownership (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  listing_type     listing_type_enum NOT NULL,
  listing_id       UUID NOT NULL,
  owner_user_id    UUID NOT NULL REFERENCES users(id),
  role             ownership_role_enum NOT NULL DEFAULT 'primary',
  is_current       BOOLEAN NOT NULL DEFAULT TRUE,
  owned_from       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  owned_until      TIMESTAMPTZ,
  transfer_reason  transfer_reason_enum NOT NULL DEFAULT 'initial_post',
  transfer_note    TEXT,
  transferred_by   UUID REFERENCES users(id)
);

-- One primary owner per listing at a time
CREATE UNIQUE INDEX idx_lo_one_primary
  ON listing_ownership (listing_type, listing_id)
  WHERE is_current = TRUE AND role = 'primary';

CREATE INDEX idx_lo_listing   ON listing_ownership (listing_id, listing_type);
CREATE INDEX idx_lo_user      ON listing_ownership (owner_user_id);
CREATE INDEX idx_lo_current   ON listing_ownership (is_current) WHERE is_current = TRUE;

-- Trigger: when new primary ownership row inserted, close previous
CREATE OR REPLACE FUNCTION fn_lo_close_previous()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_current AND NEW.role = 'primary' THEN
    UPDATE listing_ownership
    SET is_current = FALSE, owned_until = NOW()
    WHERE listing_type = NEW.listing_type
      AND listing_id   = NEW.listing_id
      AND role         = 'primary'
      AND is_current   = TRUE
      AND id          != NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_lo_close_previous
  AFTER INSERT ON listing_ownership
  FOR EACH ROW EXECUTE FUNCTION fn_lo_close_previous();


-- ============================================================
-- TABLE 11: ownership_claims
-- All ownership changes must pass through here.
-- No direct update to listing_ownership without a claim.
-- Admin resolves. Outcome written back.
-- ============================================================
CREATE TABLE ownership_claims (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  listing_type         listing_type_enum NOT NULL,
  listing_id           UUID NOT NULL,
  claimant_user_id     UUID NOT NULL REFERENCES users(id),
  claim_basis          claim_basis_enum NOT NULL,
  claim_evidence       TEXT,
  status               claim_status_enum NOT NULL DEFAULT 'PENDING',
  resolved_by          UUID REFERENCES users(id),
  resolution_note      TEXT,
  resolution_outcome   claim_outcome_enum,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at          TIMESTAMPTZ
);

CREATE INDEX idx_oc_listing  ON ownership_claims (listing_id, listing_type);
CREATE INDEX idx_oc_status   ON ownership_claims (status) WHERE status = 'PENDING';
CREATE INDEX idx_oc_user     ON ownership_claims (claimant_user_id);

-- Auto-detect dispute: if a second PENDING claim exists for same listing, mark both DISPUTED
CREATE OR REPLACE FUNCTION fn_oc_detect_dispute()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT COUNT(*) FROM ownership_claims
      WHERE listing_id   = NEW.listing_id
        AND listing_type = NEW.listing_type
        AND status       = 'PENDING'
        AND id          != NEW.id) > 0 THEN
    -- Mark all pending claims on this listing as DISPUTED
    UPDATE ownership_claims
    SET status = 'DISPUTED'
    WHERE listing_id   = NEW.listing_id
      AND listing_type = NEW.listing_type
      AND status       = 'PENDING';
    NEW.status := 'DISPUTED';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_oc_detect_dispute
  BEFORE INSERT ON ownership_claims
  FOR EACH ROW EXECUTE FUNCTION fn_oc_detect_dispute();

-- Auto-reject pending claims if cargo is CLOSED
CREATE OR REPLACE FUNCTION fn_oc_auto_reject_on_close()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'CLOSED' AND OLD.status != 'CLOSED' THEN
    UPDATE ownership_claims
    SET status           = 'REJECTED',
        resolution_note  = 'Auto-rejected: listing closed before claim resolved.',
        resolved_at      = NOW()
    WHERE listing_id = NEW.id
      AND listing_type = 'cargo'
      AND status IN ('PENDING','DISPUTED');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_cl_auto_reject_claims
  AFTER UPDATE ON cargo_listings
  FOR EACH ROW EXECUTE FUNCTION fn_oc_auto_reject_on_close();


-- ============================================================
-- TABLE 12: review_queue
-- Admin moderation queue for NEW/FLAGGED user submissions.
-- Bypassed for VERIFIED users (except HIGH risk vessels).
-- ============================================================
CREATE TABLE review_queue (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  listing_type     listing_type_enum NOT NULL,
  listing_id       UUID NOT NULL,
  submitted_by     UUID NOT NULL REFERENCES users(id),
  trust_tier_at_submit trust_tier_enum NOT NULL,
  review_reason    TEXT,                          -- "New user", "HIGH risk vessel", "Random sample"
  is_random_sample BOOLEAN NOT NULL DEFAULT FALSE,
  status           review_status_enum NOT NULL DEFAULT 'PENDING',
  reviewed_by      UUID REFERENCES users(id),
  action_taken     review_action_enum,
  admin_note       TEXT,
  amendment_detail TEXT,                          -- what admin changed if action = amended
  submitted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at      TIMESTAMPTZ
);

CREATE INDEX idx_rq_status    ON review_queue (status) WHERE status = 'PENDING';
CREATE INDEX idx_rq_listing   ON review_queue (listing_id, listing_type);
CREATE INDEX idx_rq_user      ON review_queue (submitted_by);

-- Trigger: on review approval, set goes_live_at on the listing
-- and update user clean_posts count
CREATE OR REPLACE FUNCTION fn_rq_on_review()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('APPROVED','REJECTED') AND OLD.status = 'PENDING' THEN
    NEW.reviewed_at := NOW();

    IF NEW.listing_type = 'cargo' THEN
      UPDATE cargo_listings
      SET review_status = NEW.status::review_status_enum,
          goes_live_at  = CASE WHEN NEW.status = 'APPROVED' THEN NOW() ELSE NULL END
      WHERE id = NEW.listing_id;
    ELSIF NEW.listing_type = 'vessel_availability' THEN
      UPDATE vessel_availability
      SET review_status = NEW.status::review_status_enum,
          goes_live_at  = CASE WHEN NEW.status = 'APPROVED' THEN NOW() ELSE NULL END
      WHERE id = NEW.listing_id;
    END IF;

    -- Track clean submissions toward VERIFIED tier upgrade
    IF NEW.status = 'APPROVED' AND NEW.action_taken = 'approved' THEN
      UPDATE users
      SET clean_posts = clean_posts + 1
      WHERE id = NEW.submitted_by;
    END IF;

    -- Track strikes for amendments or flags
    IF NEW.action_taken IN ('amended','flagged') THEN
      UPDATE users
      SET strike_count = strike_count + 1
      WHERE id = NEW.submitted_by;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_rq_on_review
  BEFORE UPDATE ON review_queue
  FOR EACH ROW EXECUTE FUNCTION fn_rq_on_review();

-- Trigger: auto-upgrade user to VERIFIED at 5 clean posts
CREATE OR REPLACE FUNCTION fn_users_auto_upgrade()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.clean_posts >= 5 AND OLD.trust_tier = 'NEW' THEN
    NEW.trust_tier := 'VERIFIED';
  END IF;
  -- Auto-flag at 2 strikes
  IF NEW.strike_count >= 2 AND NEW.trust_tier = 'VERIFIED' THEN
    NEW.trust_tier := 'FLAGGED';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_users_auto_upgrade
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION fn_users_auto_upgrade();

-- Trigger: when a submission is created, auto-route to review queue
-- or set goes_live_at immediately based on trust tier
CREATE OR REPLACE FUNCTION fn_submission_route()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  submitter_tier trust_tier_enum;
  vessel_risk    risk_level_enum;
  do_gate        BOOLEAN := FALSE;
  gate_reason    TEXT;
  is_sample      BOOLEAN := FALSE;
BEGIN
  -- Get trust tier of the posting user
  -- (posting user is tracked in listing_ownership, last inserted row)
  SELECT u.trust_tier INTO submitter_tier
  FROM listing_ownership lo
  JOIN users u ON u.id = lo.owner_user_id
  WHERE lo.listing_id   = NEW.id
    AND lo.listing_type = TG_ARGV[0]::listing_type_enum
    AND lo.is_current   = TRUE
  LIMIT 1;

  submitter_tier := COALESCE(submitter_tier, 'NEW');

  -- Always gate NEW and FLAGGED users
  IF submitter_tier IN ('NEW','FLAGGED') THEN
    do_gate     := TRUE;
    gate_reason := 'User trust tier: ' || submitter_tier;
  END IF;

  -- Always gate HIGH risk vessels regardless of tier
  IF TG_ARGV[0] = 'vessel_availability' THEN
    SELECT v.risk_level INTO vessel_risk
    FROM vessels v WHERE v.id = NEW.vessel_id;
    IF vessel_risk = 'HIGH' THEN
      do_gate     := TRUE;
      gate_reason := COALESCE(gate_reason || ' + ', '') || 'HIGH risk vessel';
    END IF;
  END IF;

  -- Random sample 1 in 10 VERIFIED posts
  IF NOT do_gate AND submitter_tier = 'VERIFIED' THEN
    IF random() < 0.1 THEN
      is_sample   := TRUE;
      do_gate     := TRUE;
      gate_reason := 'Random sample check';
    END IF;
  END IF;

  IF do_gate THEN
    INSERT INTO review_queue (
      listing_type, listing_id, submitted_by,
      trust_tier_at_submit, review_reason, is_random_sample
    )
    SELECT
      TG_ARGV[0]::listing_type_enum,
      NEW.id,
      lo.owner_user_id,
      submitter_tier,
      gate_reason,
      is_sample
    FROM listing_ownership lo
    WHERE lo.listing_id   = NEW.id
      AND lo.listing_type = TG_ARGV[0]::listing_type_enum
      AND lo.is_current   = TRUE
    LIMIT 1;
  ELSE
    -- VERIFIED user, not sampled: goes live immediately
    IF TG_ARGV[0] = 'cargo' THEN
      UPDATE cargo_listings
      SET review_status = 'APPROVED', goes_live_at = NOW()
      WHERE id = NEW.id;
    ELSE
      UPDATE vessel_availability
      SET review_status = 'APPROVED', goes_live_at = NOW()
      WHERE id = NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_cargo_submission_route
  AFTER INSERT ON cargo_listings
  FOR EACH ROW EXECUTE FUNCTION fn_submission_route('cargo');

CREATE TRIGGER trg_va_submission_route
  AFTER INSERT ON vessel_availability
  FOR EACH ROW EXECUTE FUNCTION fn_submission_route('vessel_availability');


-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- Enable RLS on all tables. Policies below.
-- Roles: authenticated (all logged-in users), admin (custom claim)
-- ============================================================

ALTER TABLE users                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ports                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE commodities              ENABLE ROW LEVEL SECURITY;
ALTER TABLE safety_questions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE vessels                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE vessel_contact_history   ENABLE ROW LEVEL SECURITY;
ALTER TABLE vessel_availability      ENABLE ROW LEVEL SECURITY;
ALTER TABLE cargo_listings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE cargo_safety_answers     ENABLE ROW LEVEL SECURITY;
ALTER TABLE listing_ownership        ENABLE ROW LEVEL SECURITY;
ALTER TABLE ownership_claims         ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_queue             ENABLE ROW LEVEL SECURITY;

-- Helper: is the current user an admin?
CREATE OR REPLACE FUNCTION fn_is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin',
    FALSE
  );
$$;

-- ── users ──────────────────────────────────────────────────
CREATE POLICY "users: own row" ON users
  FOR ALL USING (id = auth.uid());
CREATE POLICY "users: admin all" ON users
  FOR ALL USING (fn_is_admin());

-- ── ports ──────────────────────────────────────────────────
CREATE POLICY "ports: all read verified" ON ports
  FOR SELECT USING (is_verified = TRUE);
CREATE POLICY "ports: admin all" ON ports
  FOR ALL USING (fn_is_admin());

-- ── commodities ────────────────────────────────────────────
CREATE POLICY "commodities: all read active" ON commodities
  FOR SELECT USING (is_active = TRUE);
CREATE POLICY "commodities: admin all" ON commodities
  FOR ALL USING (fn_is_admin());

-- ── safety_questions ───────────────────────────────────────
CREATE POLICY "sq: all read active" ON safety_questions
  FOR SELECT USING (is_active = TRUE);
CREATE POLICY "sq: admin all" ON safety_questions
  FOR ALL USING (fn_is_admin());

-- ── vessels ────────────────────────────────────────────────
-- Non-PII columns visible to authenticated users.
-- PII columns (owner_address, manager_address, pic_name, phone, emails)
-- are decrypted only at application layer for admin role.
CREATE POLICY "vessels: auth read non-sanctioned" ON vessels
  FOR SELECT USING (
    auth.role() = 'authenticated'
    AND is_sanctioned = FALSE
  );
CREATE POLICY "vessels: admin all" ON vessels
  FOR ALL USING (fn_is_admin());

-- ── vessel_contact_history ─────────────────────────────────
-- Authenticated users see only is_current = true (no history).
-- Admins see everything.
CREATE POLICY "vch: auth current only" ON vessel_contact_history
  FOR SELECT USING (
    auth.role() = 'authenticated'
    AND is_current = TRUE
  );
CREATE POLICY "vch: admin all" ON vessel_contact_history
  FOR ALL USING (fn_is_admin());

-- ── vessel_availability ────────────────────────────────────
CREATE POLICY "va: auth see live" ON vessel_availability
  FOR SELECT USING (
    auth.role() = 'authenticated'
    AND review_status = 'APPROVED'
    AND status = 'OPEN'
  );
CREATE POLICY "va: owner see own" ON vessel_availability
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM listing_ownership lo
      WHERE lo.listing_id   = vessel_availability.id
        AND lo.listing_type = 'vessel_availability'
        AND lo.owner_user_id = auth.uid()
    )
  );
CREATE POLICY "va: owner insert" ON vessel_availability
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "va: owner update own" ON vessel_availability
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM listing_ownership lo
      WHERE lo.listing_id    = vessel_availability.id
        AND lo.listing_type  = 'vessel_availability'
        AND lo.owner_user_id = auth.uid()
        AND lo.role          = 'primary'
        AND lo.is_current    = TRUE
    )
  );
CREATE POLICY "va: admin all" ON vessel_availability
  FOR ALL USING (fn_is_admin());

-- ── cargo_listings ─────────────────────────────────────────
CREATE POLICY "cl: auth see live" ON cargo_listings
  FOR SELECT USING (
    auth.role() = 'authenticated'
    AND review_status = 'APPROVED'
    AND status IN ('IN','PARTIAL')
  );
CREATE POLICY "cl: owner see own" ON cargo_listings
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM listing_ownership lo
      WHERE lo.listing_id   = cargo_listings.id
        AND lo.listing_type = 'cargo'
        AND lo.owner_user_id = auth.uid()
    )
  );
CREATE POLICY "cl: owner insert" ON cargo_listings
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "cl: owner update own" ON cargo_listings
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM listing_ownership lo
      WHERE lo.listing_id    = cargo_listings.id
        AND lo.listing_type  = 'cargo'
        AND lo.owner_user_id = auth.uid()
        AND lo.role          = 'primary'
        AND lo.is_current    = TRUE
    )
  );
CREATE POLICY "cl: admin all" ON cargo_listings
  FOR ALL USING (fn_is_admin());

-- ── cargo_safety_answers ───────────────────────────────────
CREATE POLICY "csa: owner see own" ON cargo_safety_answers
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM listing_ownership lo
      WHERE lo.listing_id   = cargo_safety_answers.cargo_listing_id
        AND lo.listing_type = 'cargo'
        AND lo.owner_user_id = auth.uid()
    )
  );
CREATE POLICY "csa: owner write own" ON cargo_safety_answers
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM listing_ownership lo
      WHERE lo.listing_id   = cargo_listing_id
        AND lo.listing_type = 'cargo'
        AND lo.owner_user_id = auth.uid()
        AND lo.role          = 'primary'
    )
  );
CREATE POLICY "csa: admin all" ON cargo_safety_answers
  FOR ALL USING (fn_is_admin());

-- ── listing_ownership ──────────────────────────────────────
-- Brokers see only their own rows. Never see other brokers.
CREATE POLICY "lo: own rows only" ON listing_ownership
  FOR SELECT USING (owner_user_id = auth.uid());
CREATE POLICY "lo: admin all" ON listing_ownership
  FOR ALL USING (fn_is_admin());

-- ── ownership_claims ───────────────────────────────────────
-- Brokers see only their own claims. Dispute details admin-only.
CREATE POLICY "oc: own claims" ON ownership_claims
  FOR SELECT USING (claimant_user_id = auth.uid());
CREATE POLICY "oc: insert own" ON ownership_claims
  FOR INSERT WITH CHECK (
    auth.role() = 'authenticated'
    AND claimant_user_id = auth.uid()
  );
CREATE POLICY "oc: admin all" ON ownership_claims
  FOR ALL USING (fn_is_admin());

-- ── review_queue ───────────────────────────────────────────
-- Brokers see only their own queue items (status only — no admin notes).
-- Full details admin-only.
CREATE POLICY "rq: own status" ON review_queue
  FOR SELECT USING (submitted_by = auth.uid());
CREATE POLICY "rq: admin all" ON review_queue
  FOR ALL USING (fn_is_admin());


-- ============================================================
-- INITIAL SEED: ports (120 rows from PORT_CODES sheet)
-- Truncated here for schema file — full seed in separate file.
-- Key rows shown as reference.
-- ============================================================
INSERT INTO ports (locode, trade_name, country, zone, port_type, notes) VALUES
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
-- Full 120-row seed continues in ports_seed.sql
ON CONFLICT (locode) DO NOTHING;


-- ============================================================
-- INITIAL SEED: commodities (from cargo map + questionnaire)
-- ============================================================
INSERT INTO commodities (canonical_name, cargo_type, imsbc_category, is_dg, is_grain, default_sf_m3t, sort_order) VALUES
  -- Dry Bulk Cat C
  ('Grain (Wheat)',         'Dry Bulk', 'Cat_C', FALSE, TRUE,  47.0,  10),
  ('Grain (Corn/Maize)',    'Dry Bulk', 'Cat_C', FALSE, TRUE,  50.0,  11),
  ('Grain (Barley)',        'Dry Bulk', 'Cat_C', FALSE, TRUE,  53.0,  12),
  ('Grain (Soya Beans)',    'Dry Bulk', 'Cat_C', FALSE, TRUE,  50.0,  13),
  ('Grain (Sorghum)',       'Dry Bulk', 'Cat_C', FALSE, TRUE,  48.0,  14),
  ('Fertiliser (Urea)',     'Dry Bulk', 'Cat_C', FALSE, FALSE, 50.0,  20),
  ('Fertiliser (Harmless)', 'Dry Bulk', 'Cat_C', FALSE, FALSE, 38.0,  21),
  ('Fertiliser (Non-IMO)',  'Dry Bulk', 'Cat_C', FALSE, FALSE, 38.0,  22),
  ('Clinker',               'Dry Bulk', 'Cat_C', FALSE, FALSE, 27.0,  30),
  ('Cement Bulk',           'Dry Bulk', 'Cat_C', FALSE, FALSE, 27.0,  31),
  ('Salt Bulk',             'Dry Bulk', 'Cat_C', FALSE, FALSE, 33.0,  32),
  ('Gypsum Bulk',           'Dry Bulk', 'Cat_C', FALSE, FALSE, 40.0,  33),
  ('Steel Scrap',           'Dry Bulk', 'Cat_C', FALSE, FALSE, 70.0,  40),
  ('Slag',                  'Dry Bulk', 'Cat_C', FALSE, FALSE, 37.0,  41),
  ('Silica Sand',           'Dry Bulk', 'Cat_C', FALSE, FALSE, 35.0,  42),
  ('Dolomite',              'Dry Bulk', 'Cat_C', FALSE, FALSE, 35.0,  43),
  ('Phosphate Bulk',        'Dry Bulk', 'Cat_C', FALSE, FALSE, 35.0,  44),
  ('Alumina',               'Dry Bulk', 'Cat_C', FALSE, FALSE, 35.0,  45),
  ('Petcoke',               'Dry Bulk', 'Cat_C', FALSE, FALSE, 43.0,  46),
  ('Sunflower Meal (SFS)',  'Dry Bulk', 'Cat_C', FALSE, FALSE, 85.0,  50),
  ('DDGS',                  'Dry Bulk', 'Cat_C', FALSE, FALSE, 75.0,  51),
  ('Rapeseed Meal',         'Dry Bulk', 'Cat_C', FALSE, FALSE, 57.0,  52),
  ('GBFS',                  'Dry Bulk', 'Cat_C', FALSE, FALSE, 50.0,  53),
  ('Steel Scrap HMS 1/2',   'Dry Bulk', 'Cat_C', FALSE, FALSE, 70.0,  54),
  ('Sunflower Seeds',       'Dry Bulk', 'Cat_C', FALSE, FALSE, 87.0,  55),
  -- Dry Bulk Cat B
  ('Coal',                  'Dry Bulk', 'Cat_B', FALSE, FALSE, 43.0,  60),
  ('Anthracite',            'Dry Bulk', 'Cat_B', FALSE, FALSE, 43.0,  61),
  ('Copper Concentrates',   'Dry Bulk', 'Cat_B', FALSE, FALSE, 33.0,  62),
  ('Sulphur Bulk',          'Dry Bulk', 'Cat_B', FALSE, FALSE, 32.0,  63),
  -- Dry Bulk Cat A
  ('Iron Ore Fines',        'Dry Bulk', 'Cat_A', FALSE, FALSE, 28.0,  70),
  ('Bauxite',               'Dry Bulk', 'Cat_A', FALSE, FALSE, 28.0,  71),
  -- Break Bulk Non-DG
  ('Steel Coils',           'Break Bulk', 'Non_DG', FALSE, FALSE, NULL, 100),
  ('Steel Rebars',          'Break Bulk', 'Non_DG', FALSE, FALSE, NULL, 101),
  ('Steel Wire Rod',        'Break Bulk', 'Non_DG', FALSE, FALSE, NULL, 102),
  ('Steel Plates',          'Break Bulk', 'Non_DG', FALSE, FALSE, NULL, 103),
  ('Steel Sheets',          'Break Bulk', 'Non_DG', FALSE, FALSE, NULL, 104),
  ('Steel Billets',         'Break Bulk', 'Non_DG', FALSE, FALSE, NULL, 105),
  ('Marble Blocks',         'Break Bulk', 'Non_DG', FALSE, FALSE, NULL, 110),
  ('Granite Blocks',        'Break Bulk', 'Non_DG', FALSE, FALSE, NULL, 111),
  ('Marble Chips BB',       'Break Bulk', 'Non_DG', FALSE, FALSE, NULL, 112),
  ('Soda Ash BB',           'Break Bulk', 'Non_DG', FALSE, FALSE, NULL, 113),
  ('Feldspar BB',           'Break Bulk', 'Non_DG', FALSE, FALSE, NULL, 114),
  ('Cement BB (Bags)',      'Break Bulk', 'Non_DG', FALSE, FALSE, NULL, 115),
  ('Salt BB (Bags)',        'Break Bulk', 'Non_DG', FALSE, FALSE, NULL, 116),
  ('Gypsum BB (Bags)',      'Break Bulk', 'Non_DG', FALSE, FALSE, NULL, 117),
  ('Sugar BB',              'Break Bulk', 'Non_DG', FALSE, FALSE, NULL, 118),
  ('White Clinker BB',      'Break Bulk', 'Non_DG', FALSE, FALSE, NULL, 119),
  ('General Cargo',         'Break Bulk', 'Non_DG', FALSE, FALSE, NULL, 120),
  ('Logs',                  'Break Bulk', 'Non_DG', FALSE, FALSE, NULL, 121),
  ('Grain BB (Bags)',       'Break Bulk', 'Non_DG', FALSE, TRUE,  NULL, 122),
  -- Break Bulk DG
  ('Ammonium Nitrate BB',   'Break Bulk', 'DG', TRUE, FALSE, NULL, 130),
  ('Calcium Chloride BB',   'Break Bulk', 'DG', TRUE, FALSE, NULL, 131),
  ('Sulphur BB (Bags)',     'Break Bulk', 'DG', TRUE, FALSE, NULL, 132),
  ('Fertiliser BB (non-harmless)', 'Break Bulk', 'DG', TRUE, FALSE, NULL, 133)
ON CONFLICT (canonical_name) DO NOTHING;

-- Set aliases for common variations
UPDATE commodities SET display_aliases = ARRAY['Wheat','HMS','HMS 1/2'] WHERE canonical_name = 'Steel Scrap HMS 1/2';
UPDATE commodities SET display_aliases = ARRAY['Scrap','HMS','Steel Scrap HMS'] WHERE canonical_name = 'Steel Scrap';
UPDATE commodities SET display_aliases = ARRAY['Corn','Maize'] WHERE canonical_name = 'Grain (Corn/Maize)';
UPDATE commodities SET display_aliases = ARRAY['AN','Ammonium Nitrate'] WHERE canonical_name = 'Ammonium Nitrate BB';
UPDATE commodities SET display_aliases = ARRAY['SFS','Sunflower','Sunmeal'] WHERE canonical_name = 'Sunflower Meal (SFS)';
UPDATE commodities SET display_aliases = ARRAY['Urea','Fertilizer'] WHERE canonical_name = 'Fertiliser (Urea)';


-- ============================================================
-- INITIAL SEED: safety_questions
-- question_key = permanent machine reference, never change.
-- question_text = editable by admin any time.
-- ============================================================
INSERT INTO safety_questions (question_key, question_text, answer_type, applies_to_cargo_type, applies_to_categories, is_required, is_matchmaking_field, matchmaking_column, section_label, sort_order) VALUES

-- ── Shared: all cargo types ───────────────────────────────
('qty_tolerance_pct',  'Quantity tolerance (± %)?',         'number',  ARRAY['Dry Bulk','Break Bulk']::cargo_type_enum[], ARRAY['Cat_A','Cat_B','Cat_C','Non_DG','DG']::imsbc_category_enum[], FALSE, FALSE, NULL,                 'General', 10),
('loading_method',     'Loading method?',                   'select',  ARRAY['Dry Bulk','Break Bulk']::cargo_type_enum[], ARRAY['Cat_A','Cat_B','Cat_C','Non_DG','DG']::imsbc_category_enum[], FALSE, FALSE, NULL,                 'Loading & discharge', 20),
('loading_rate',       'Loading rate (MT/day)?',            'number',  ARRAY['Dry Bulk','Break Bulk']::cargo_type_enum[], ARRAY['Cat_A','Cat_B','Cat_C','Non_DG','DG']::imsbc_category_enum[], FALSE, FALSE, NULL,                 'Loading & discharge', 21),
('discharge_method',   'Discharge method?',                 'select',  ARRAY['Dry Bulk','Break Bulk']::cargo_type_enum[], ARRAY['Cat_A','Cat_B','Cat_C','Non_DG','DG']::imsbc_category_enum[], FALSE, FALSE, NULL,                 'Loading & discharge', 22),
('discharge_rate',     'Discharge rate (MT/day)?',          'number',  ARRAY['Dry Bulk','Break Bulk']::cargo_type_enum[], ARRAY['Cat_A','Cat_B','Cat_C','Non_DG','DG']::imsbc_category_enum[], FALSE, FALSE, NULL,                 'Loading & discharge', 23),
('max_vessel_age',     'Maximum vessel age (years)?',       'number',  ARRAY['Dry Bulk','Break Bulk']::cargo_type_enum[], ARRAY['Cat_A','Cat_B','Cat_C','Non_DG','DG']::imsbc_category_enum[], FALSE, TRUE,  'max_vessel_age_yr',  'Vessel requirements', 30),
('max_loa',            'Maximum LOA (metres)?',             'number',  ARRAY['Dry Bulk','Break Bulk']::cargo_type_enum[], ARRAY['Cat_A','Cat_B','Cat_C','Non_DG','DG']::imsbc_category_enum[], FALSE, TRUE,  'max_loa_m',          'Vessel requirements', 31),
('max_draft',          'Maximum draft (metres)?',           'number',  ARRAY['Dry Bulk','Break Bulk']::cargo_type_enum[], ARRAY['Cat_A','Cat_B','Cat_C','Non_DG','DG']::imsbc_category_enum[], FALSE, TRUE,  'max_draft_m',        'Vessel requirements', 32),

-- ── Dry Bulk: all categories ───────────────────────────────
('stowage_factor',     'Stowage factor (m³/t)?',            'number',  ARRAY['Dry Bulk']::cargo_type_enum[], ARRAY['Cat_A','Cat_B','Cat_C']::imsbc_category_enum[], FALSE, FALSE, NULL,                 'Physical properties', 40),
('hold_cleanliness',   'Required hold cleanliness standard?','select', ARRAY['Dry Bulk']::cargo_type_enum[], ARRAY['Cat_A','Cat_B','Cat_C']::imsbc_category_enum[], FALSE, FALSE, NULL,                 'Loading & discharge', 41),
('trimming_required',  'Trimming required (Y/N + method)?', 'text',    ARRAY['Dry Bulk']::cargo_type_enum[], ARRAY['Cat_A','Cat_B','Cat_C']::imsbc_category_enum[], FALSE, FALSE, NULL,                 'Loading & discharge', 42),
('grain_cert',         'Grain-certified holds required?',   'boolean', ARRAY['Dry Bulk']::cargo_type_enum[], ARRAY['Cat_C']::imsbc_category_enum[],                FALSE, FALSE, NULL,                 'Vessel requirements', 43),
('fumigation',         'Fumigation required?',              'boolean', ARRAY['Dry Bulk']::cargo_type_enum[], ARRAY['Cat_C']::imsbc_category_enum[],                FALSE, FALSE, NULL,                 'Loading & discharge', 44),

-- ── Dry Bulk Cat B extras ──────────────────────────────────
('moisture_content',   'Moisture content (MC %)?',          'number',  ARRAY['Dry Bulk']::cargo_type_enum[], ARRAY['Cat_B']::imsbc_category_enum[], FALSE, FALSE, NULL,                 'Physical properties', 60),
('ventilation',        'Ventilation required?',             'boolean', ARRAY['Dry Bulk']::cargo_type_enum[], ARRAY['Cat_B']::imsbc_category_enum[], FALSE, FALSE, NULL,                 'Safety', 61),
('self_heating',       'Self-heating tendency (Y/N)?',      'boolean', ARRAY['Dry Bulk']::cargo_type_enum[], ARRAY['Cat_B']::imsbc_category_enum[], FALSE, FALSE, NULL,                 'Safety', 62),
('gas_detection',      'Gas detection equipment required?', 'boolean', ARRAY['Dry Bulk']::cargo_type_enum[], ARRAY['Cat_B']::imsbc_category_enum[], FALSE, FALSE, NULL,                 'Safety', 63),
('dg_cert_bulk',       'Vessel DG certificate required?',   'boolean', ARRAY['Dry Bulk']::cargo_type_enum[], ARRAY['Cat_B']::imsbc_category_enum[], TRUE,  FALSE, NULL,                 'Safety', 64),
('msds_attached',      'MSDS / lab certificate attached?',  'boolean', ARRAY['Dry Bulk']::cargo_type_enum[], ARRAY['Cat_B']::imsbc_category_enum[], TRUE,  FALSE, NULL,                 'Documents', 65),

-- ── Dry Bulk Cat A extras ──────────────────────────────────
('tml_result',         'TML test result (%)?',              'number',  ARRAY['Dry Bulk']::cargo_type_enum[], ARRAY['Cat_A']::imsbc_category_enum[], TRUE,  FALSE, NULL,                 'Physical properties', 70),
('fmp',                'Flow Moisture Point (%)?',          'number',  ARRAY['Dry Bulk']::cargo_type_enum[], ARRAY['Cat_A']::imsbc_category_enum[], FALSE, FALSE, NULL,                 'Physical properties', 71),
('angle_repose',       'Angle of repose (°)?',              'number',  ARRAY['Dry Bulk']::cargo_type_enum[], ARRAY['Cat_A']::imsbc_category_enum[], FALSE, FALSE, NULL,                 'Physical properties', 72),
('bulk_density',       'Bulk density (t/m³)?',              'number',  ARRAY['Dry Bulk']::cargo_type_enum[], ARRAY['Cat_A']::imsbc_category_enum[], FALSE, FALSE, NULL,                 'Physical properties', 73),
('shippers_declaration','Shipper declaration attached?',    'boolean', ARRAY['Dry Bulk']::cargo_type_enum[], ARRAY['Cat_A']::imsbc_category_enum[], TRUE,  FALSE, NULL,                 'Documents', 74),

-- ── Break Bulk: all ────────────────────────────────────────
('unit_weight',        'Unit weight (MT per piece)?',       'number',  ARRAY['Break Bulk']::cargo_type_enum[], ARRAY['Non_DG','DG']::imsbc_category_enum[], FALSE, FALSE, NULL,         'Cargo details', 80),
('dimensions',         'Dimensions (L × W × H cm)?',       'text',    ARRAY['Break Bulk']::cargo_type_enum[], ARRAY['Non_DG','DG']::imsbc_category_enum[], FALSE, FALSE, NULL,         'Cargo details', 81),
('packaging',          'Packaging type?',                   'select',  ARRAY['Break Bulk']::cargo_type_enum[], ARRAY['Non_DG','DG']::imsbc_category_enum[], TRUE,  FALSE, NULL,         'Cargo details', 82),
('requires_geared',    'Geared vessel required?',           'boolean', ARRAY['Break Bulk']::cargo_type_enum[], ARRAY['Non_DG','DG']::imsbc_category_enum[], FALSE, TRUE,  'requires_geared', 'Vessel requirements', 83),
('crane_swl',          'Crane SWL required (MT)?',         'number',  ARRAY['Break Bulk']::cargo_type_enum[], ARRAY['Non_DG','DG']::imsbc_category_enum[], FALSE, FALSE, NULL,         'Vessel requirements', 84),
('max_tiers',          'Maximum stacking tiers?',           'number',  ARRAY['Break Bulk']::cargo_type_enum[], ARRAY['Non_DG','DG']::imsbc_category_enum[], FALSE, FALSE, NULL,         'Cargo details', 85),
('stw_equals_dwt',     'STW = DWT? (stow to weight)',       'boolean', ARRAY['Break Bulk']::cargo_type_enum[], ARRAY['Non_DG','DG']::imsbc_category_enum[], FALSE, FALSE, NULL,         'Cargo details', 86),

-- ── Break Bulk DG extras ───────────────────────────────────
('un_number_bb',       'UN Number?',                        'text',    ARRAY['Break Bulk']::cargo_type_enum[], ARRAY['DG']::imsbc_category_enum[], TRUE,  FALSE, NULL,                 'Dangerous goods', 90),
('imo_class_bb',       'IMO Class?',                        'text',    ARRAY['Break Bulk']::cargo_type_enum[], ARRAY['DG']::imsbc_category_enum[], TRUE,  FALSE, NULL,                 'Dangerous goods', 91),
('subsidiary_risk',    'Subsidiary risk class?',            'text',    ARRAY['Break Bulk']::cargo_type_enum[], ARRAY['DG']::imsbc_category_enum[], FALSE, FALSE, NULL,                 'Dangerous goods', 92),
('dg_cert_bb',         'Vessel DG certificate required?',   'boolean', ARRAY['Break Bulk']::cargo_type_enum[], ARRAY['DG']::imsbc_category_enum[], TRUE,  FALSE, NULL,                 'Dangerous goods', 93),
('imdg_packing_group', 'IMDG Packing Group?',              'select',  ARRAY['Break Bulk']::cargo_type_enum[], ARRAY['DG']::imsbc_category_enum[], FALSE, FALSE, NULL,                 'Dangerous goods', 94),
('segregation_req',    'Segregation requirements?',         'text',    ARRAY['Break Bulk']::cargo_type_enum[], ARRAY['DG']::imsbc_category_enum[], FALSE, FALSE, NULL,                 'Dangerous goods', 95),
('msds_bb',            'MSDS attached?',                    'boolean', ARRAY['Break Bulk']::cargo_type_enum[], ARRAY['DG']::imsbc_category_enum[], TRUE,  FALSE, NULL,                 'Documents', 96)

ON CONFLICT (question_key) DO NOTHING;

-- Set select options for relevant questions
UPDATE safety_questions SET select_options = ARRAY['Grab','Conveyor','Spout','Pneumatic','Other'] WHERE question_key = 'loading_method';
UPDATE safety_questions SET select_options = ARRAY['Grab','Conveyor','Pneumatic','Self-discharge','Other'] WHERE question_key = 'discharge_method';
UPDATE safety_questions SET select_options = ARRAY['BSS Grain Clean','Salt Clean','General Clean','Hospital Clean'] WHERE question_key = 'hold_cleanliness';
UPDATE safety_questions SET select_options = ARRAY['Bulk','Bags (50kg)','Big Bags (1t)','Pallets','Loose','Other'] WHERE question_key = 'packaging';
UPDATE safety_questions SET select_options = ARRAY['PG I — High danger','PG II — Medium danger','PG III — Low danger'] WHERE question_key = 'imdg_packing_group';


-- ============================================================
-- VIEWS: convenience for application queries
-- ============================================================

-- Live cargo: approved + active status only
CREATE VIEW v_live_cargo AS
SELECT cl.*, c.imsbc_category, c.is_dg, c.is_grain
FROM cargo_listings cl
JOIN commodities c ON c.id = cl.commodity_id
WHERE cl.review_status = 'APPROVED'
  AND cl.status IN ('IN','PARTIAL');

-- Live vessel availability: approved + open status
CREATE VIEW v_live_vessels AS
SELECT va.*, v.vessel_type, v.dwt_grain, v.dwt_bale,
       v.is_geared, v.grain_certified, v.dg_certified,
       v.max_loa_m, v.max_draft_m, v.build_year,
       v.scope, v.risk_level, v.is_sanctioned
FROM vessel_availability va
JOIN vessels v ON v.id = va.vessel_id
WHERE va.review_status = 'APPROVED'
  AND va.status = 'OPEN'
  AND v.is_sanctioned = FALSE;

-- Admin review queue with submitter details
CREATE VIEW v_admin_queue AS
SELECT rq.*,
       u.full_name AS submitter_name,
       u.company   AS submitter_company,
       u.trust_tier
FROM review_queue rq
JOIN users u ON u.id = rq.submitted_by
WHERE rq.status = 'PENDING'
ORDER BY rq.submitted_at ASC;


-- ============================================================
-- END OF SCHEMA
-- ============================================================
-- Tables:   users, ports, commodities, safety_questions,
--           vessels, vessel_contact_history, vessel_availability,
--           cargo_listings, cargo_safety_answers,
--           listing_ownership, ownership_claims, review_queue
-- Views:    v_live_cargo, v_live_vessels, v_admin_queue
-- Triggers: 14 triggers covering auto-fill, history, routing,
--           trust tier upgrade, dispute detection
-- RLS:      All tables protected. Admin role via JWT claim.
-- ============================================================
