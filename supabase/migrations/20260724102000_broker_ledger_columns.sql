-- ════════════════════════════════════════════════════════════════════════
-- Broker Ledger phase 1c: columns for the rebuilt posting flows
--
-- Adds the minimum-capture fields the Concept 4 Broker Ledger writes, per
-- the Q88/Baltic-99 vessel contract (reference/handoff/asb/vessel-schema-q88.js)
-- and the 24-Jul UNIFIED workbook 09_VESSEL_FIELD_SPEC / 11_VALIDATION.
--
-- Column names stay in the existing legacy style; each vessel column's Q88
-- canonical key is recorded in a COMMENT. The full canonical rename the
-- handoff README requests is deliberately deferred (high blast radius across
-- boards/sync/admin for no user-visible gain) — flagged back to the business.
--
-- All additions nullable; additive + idempotent.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. vessels: cargo arrangement / configuration / ownership chain ─────────
ALTER TABLE public.vessels
  ADD COLUMN IF NOT EXISTS num_holds          smallint,
  ADD COLUMN IF NOT EXISTS num_hatches        smallint,
  ADD COLUMN IF NOT EXISTS box_shaped         boolean,
  ADD COLUMN IF NOT EXISTS hatch_type         text,
  ADD COLUMN IF NOT EXISTS strengthened_heavy boolean,
  ADD COLUMN IF NOT EXISTS holds_may_be_empty text,
  ADD COLUMN IF NOT EXISTS log_fitted         boolean,
  ADD COLUMN IF NOT EXISTS vessel_config      text,
  ADD COLUMN IF NOT EXISTS beam_m             numeric(5,2),
  ADD COLUMN IF NOT EXISTS kick_plate         boolean,
  ADD COLUMN IF NOT EXISTS hold_details       jsonb,
  ADD COLUMN IF NOT EXISTS class_society      text,
  ADD COLUMN IF NOT EXISTS registered_owner   text,
  ADD COLUMN IF NOT EXISTS parent_group       text,
  ADD COLUMN IF NOT EXISTS technical_operator text,
  ADD COLUMN IF NOT EXISTS disponent_owner    text,
  ADD COLUMN IF NOT EXISTS is_tbn             boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_verified        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS source_tag         text;

COMMENT ON COLUMN public.vessels.num_holds          IS 'Q88 holds.numHolds (§5.1). Max 9 per contract; enforced in RPC.';
COMMENT ON COLUMN public.vessels.num_hatches        IS 'Q88 holds.numHatches. Defaults = holds; override only.';
COMMENT ON COLUMN public.vessels.box_shaped         IS 'Q88 holds.boxShaped.';
COMMENT ON COLUMN public.vessels.hatch_type         IS 'Q88 holds.hatchType: side-rolling | folding | pontoon | lift-away.';
COMMENT ON COLUMN public.vessels.strengthened_heavy IS 'Q88 holds.strengthenedHeavy.';
COMMENT ON COLUMN public.vessels.holds_may_be_empty IS 'Q88 holds.holdsMayBeEmpty (Y/N or which holds).';
COMMENT ON COLUMN public.vessels.log_fitted         IS 'Q88 holds.logsFitted.';
COMMENT ON COLUMN public.vessels.vessel_config      IS 'Vessel Configuration attribute (NOT a type): Geared Bulk Carrier | Multi Purpose | Open Hatch. Blank = standard.';
COMMENT ON COLUMN public.vessels.beam_m             IS 'Q88 dimensions.beam.';
COMMENT ON COLUMN public.vessels.kick_plate         IS 'Q88 gear.kickPlate.';
COMMENT ON COLUMN public.vessels.hold_details       IS 'Q88 holds.holds[1..9]: {grainCapacity, baleCapacity, tanktopGrabDischarge, co2Fitted, smokeDetection, hoppered{side,fwd,aft}, grainFitSolasVI, a60Bulkhead}.';
COMMENT ON COLUMN public.vessels.class_society      IS 'Q88 build.classSociety.';
COMMENT ON COLUMN public.vessels.registered_owner   IS 'Q88 ownership.registeredOwner (5-tier chain, tier 1). Company name → organizations.';
COMMENT ON COLUMN public.vessels.parent_group       IS 'Q88 ownership.parentGroup (tier 2).';
COMMENT ON COLUMN public.vessels.technical_operator IS 'Q88 ownership.technicalOperator / ISM manager (tier 3).';
COMMENT ON COLUMN public.vessels.disponent_owner    IS 'Q88 ownership.disponentOwner (tier 5). Commercial operator (tier 4) = existing manager_company.';
COMMENT ON COLUMN public.vessels.is_tbn             IS 'To-be-nominated listing: full particulars, identity (name/IMO) withheld until fixture. Excluded from registry search.';
COMMENT ON COLUMN public.vessels.is_verified        IS 'Q88 meta.verified: flips true when ASB confirms the record / Q88 is complete.';
COMMENT ON COLUMN public.vessels.source_tag         IS 'Provenance: workbook_24jul | user | q88_import | …';

ALTER TABLE public.vessels DROP CONSTRAINT IF EXISTS vessels_num_holds_chk;
ALTER TABLE public.vessels ADD CONSTRAINT vessels_num_holds_chk
  CHECK (num_holds IS NULL OR num_holds BETWEEN 1 AND 9);
ALTER TABLE public.vessels DROP CONSTRAINT IF EXISTS vessels_hatch_type_chk;
ALTER TABLE public.vessels ADD CONSTRAINT vessels_hatch_type_chk
  CHECK (hatch_type IS NULL OR hatch_type IN ('side-rolling','folding','pontoon','lift-away'));
ALTER TABLE public.vessels DROP CONSTRAINT IF EXISTS vessels_vessel_config_chk;
ALTER TABLE public.vessels ADD CONSTRAINT vessels_vessel_config_chk
  CHECK (vessel_config IS NULL OR vessel_config IN ('Geared Bulk Carrier','Multi Purpose','Open Hatch'));

-- The new columns are non-PII reference/particular data. The vessel contact
-- firewall (20260713165215 §6b) revoked blanket SELECT and re-granted
-- column-by-column, so newly added columns default to NOT readable — grant them.
GRANT SELECT (num_holds, num_hatches, box_shaped, hatch_type, strengthened_heavy,
              holds_may_be_empty, log_fitted, vessel_config, beam_m, kick_plate,
              hold_details, class_society, is_tbn, is_verified, source_tag)
  ON public.vessels TO anon, authenticated;
-- Ownership-chain names are commercial info, not contact PII (companies are in
-- the public registry); the design shows them to any tier with detail gated.
GRANT SELECT (registered_owner, parent_group, technical_operator, disponent_owner)
  ON public.vessels TO authenticated;

-- Rebuild the masking view so it includes the new columns (its DO block reads
-- information_schema at creation time). PII list identical to 20260713165215.
DROP VIEW IF EXISTS public.v_vessel_detail;
DO $$
DECLARE
  pii text[] := ARRAY[
    'owner_company','owner_country',
    'manager_company','manager_country',
    'commercial_manager_company','commercial_manager_country',
    'commercial_manager_contact','commercial_manager_email','commercial_manager_phone',
    'pic_name','website',
    'tc_charterer_name','bbc_charterer_name',
    'charter_status','tc_expiry','bbc_expiry','pi_club','pi_ig_member',
    'pi_coverage_types','war_risk_trading','war_risk_conditions','preferred_trading_areas'
  ];
  sel text := '';
  col text;
BEGIN
  FOR col IN
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'vessels'
    ORDER BY ordinal_position
  LOOP
    IF sel <> '' THEN sel := sel || ', '; END IF;
    IF col = ANY (pii) THEN
      sel := sel || format(
        'CASE WHEN public.is_admin() OR public.fn_is_vessel_owner(v.id) '
        || 'THEN v.%I ELSE NULL END AS %I', col, col);
    ELSE
      sel := sel || format('v.%I', col);
    END IF;
  END LOOP;

  EXECUTE format(
    'CREATE VIEW public.v_vessel_detail AS SELECT %s FROM public.vessels v '
    || 'WHERE v.is_sanctioned = FALSE '
    || 'OR public.is_admin() OR public.fn_is_vessel_owner(v.id)',
    sel);
END $$;
GRANT SELECT ON public.v_vessel_detail TO authenticated;

-- v_my_vessels selects v.* and picks new columns up automatically, but must be
-- recreated so the view definition includes them.
DROP VIEW IF EXISTS public.v_my_vessels;
CREATE VIEW public.v_my_vessels AS
WITH latest_open AS (
  SELECT DISTINCT ON (va.vessel_id)
    va.vessel_id, va.open_port_name, va.open_port_locode, va.open_zone, va.open_date
  FROM public.vessel_availability va
  WHERE va.status = 'OPEN' AND va.review_status = 'APPROVED'
  ORDER BY va.vessel_id, va.created_at DESC
),
open_counts AS (
  SELECT va.vessel_id,
         COUNT(*) FILTER (WHERE va.status = 'OPEN' AND va.review_status = 'APPROVED')
           AS open_availability_count
  FROM public.vessel_availability va
  GROUP BY va.vessel_id
)
SELECT
  v.*,
  vc.user_id,
  vc.role       AS claim_role,
  vc.created_at AS claimed_at,
  COALESCE(oc.open_availability_count, 0)::BIGINT AS open_availability_count,
  lo.open_port_name, lo.open_port_locode, lo.open_zone, lo.open_date
FROM public.vessel_claims vc
JOIN public.vessels v ON v.id = vc.vessel_id
LEFT JOIN open_counts oc ON oc.vessel_id = v.id
LEFT JOIN latest_open lo ON lo.vessel_id = v.id
WHERE vc.user_id = auth.uid();
GRANT SELECT ON public.v_my_vessels TO authenticated;

-- ── 2. vessel_availability: commercial position fields ──────────────────────
ALTER TABLE public.vessel_availability
  ADD COLUMN IF NOT EXISTS charter_type    text,
  ADD COLUMN IF NOT EXISTS is_wog          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS next_direction  text,
  ADD COLUMN IF NOT EXISTS trading_zones   public.zone_enum[],
  ADD COLUMN IF NOT EXISTS scrubber_fitted boolean,
  ADD COLUMN IF NOT EXISTS eca_compliant   boolean;

ALTER TABLE public.vessel_availability DROP CONSTRAINT IF EXISTS vessel_availability_charter_type_chk;
ALTER TABLE public.vessel_availability ADD CONSTRAINT vessel_availability_charter_type_chk
  CHECK (charter_type IS NULL OR charter_type IN ('V/C','TCT','T/C short','T/C long','Bareboat'));

COMMENT ON COLUMN public.vessel_availability.charter_type   IS 'How she currently trades (Q88 commercial.charterType). T/C or Bareboat ⇒ lister is a disponent operator — quiet verification, no user-facing banner.';
COMMENT ON COLUMN public.vessel_availability.is_wog         IS 'Rates without guarantee — position shown as indication only.';
COMMENT ON COLUMN public.vessel_availability.next_direction IS 'Where she would prefer to trade next; guides matching.';
COMMENT ON COLUMN public.vessel_availability.trading_zones  IS 'Zones she will trade this position (workbook TRADING_ZONE, multi).';

-- ── 3. cargo_listings: laytime / rate mechanics + commercial flags ──────────
ALTER TABLE public.cargo_listings
  ADD COLUMN IF NOT EXISTS rate_mechanism     text,
  ADD COLUMN IF NOT EXISTS day_exceptions     text,
  ADD COLUMN IF NOT EXISTS turn_time_hrs      numeric(5,1),
  ADD COLUMN IF NOT EXISTS laytime_reversible text,
  ADD COLUMN IF NOT EXISTS freight_basis      text,
  ADD COLUMN IF NOT EXISTS despatch_basis     text,
  ADD COLUMN IF NOT EXISTS iac_flag           boolean NOT NULL DEFAULT false;

ALTER TABLE public.cargo_listings DROP CONSTRAINT IF EXISTS cargo_listings_laytime_reversible_chk;
ALTER TABLE public.cargo_listings ADD CONSTRAINT cargo_listings_laytime_reversible_chk
  CHECK (laytime_reversible IS NULL OR laytime_reversible IN ('Non-reversible','Reversible','Average'));

COMMENT ON COLUMN public.cargo_listings.rate_mechanism     IS 'How the load/discharge rate is expressed: Per day (MT/day) | Per hatch / day | Per working hatch / day | CQD | Total days (BIMCO defs 6/7).';
COMMENT ON COLUMN public.cargo_listings.day_exceptions     IS 'Which days count toward laytime: WWD FHEX | WWD SHINC | WWD SHEX | FHEX | SHINC | SHEX EIU | CQD.';
COMMENT ON COLUMN public.cargo_listings.turn_time_hrs      IS 'Free period after NOR before laytime counts (BIMCO Laytime Definitions).';
COMMENT ON COLUMN public.cargo_listings.laytime_reversible IS 'Load vs discharge laytime: Non-reversible (separate) | Reversible (BIMCO def 24) | Average (def 23).';
COMMENT ON COLUMN public.cargo_listings.iac_flag           IS 'Freight includes address commission.';

-- ── 4. organizations: workbook 03_COMPANIES registry fields ─────────────────
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS owns_count         integer,
  ADD COLUMN IF NOT EXISTS manages_comm_count integer,
  ADD COLUMN IF NOT EXISTS ism_manages_count  integer,
  ADD COLUMN IF NOT EXISTS linked_to_imo      text,
  ADD COLUMN IF NOT EXISTS link_note          text,
  ADD COLUMN IF NOT EXISTS link_type          text,
  ADD COLUMN IF NOT EXISTS source_tag         text;

COMMENT ON COLUMN public.organizations.linked_to_imo IS 'Firm-to-firm link (parent/affiliate) by COMPANY IMO — not firm-to-vessel.';
