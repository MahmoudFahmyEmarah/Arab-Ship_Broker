-- ════════════════════════════════════════════════════════════════════
-- Vessel → organization link  · append-only · firewall-safe
--
-- Connects every broker-imported vessel to its company profile in the
-- organizations registry (seeded in …000840), replacing the DEMO hash stub
-- (lib/portal/org.ts orgForVessel) with a real owner_org_id / manager_org_id.
--
-- Source of truth is the vessel row's own owner_company / manager_company text
-- (the workbook REG_OWNER_COMPANY / SHIP_COMM_MANAGER). Those strings match a
-- seeded organizations.name EXACTLY (verified 100% over the 88-vessel workbook:
-- owner 54/54, ship/commercial manager 68/68), so the backfill is a plain
-- case-insensitive name join — lossless and idempotent.
--
-- FIREWALL (NON-NEGOTIABLE): the org-link columns are identity-revealing, so
-- they are NOT granted at the base table (they fall outside the …000600 GRANT
-- list, hence stay REVOKE'd) and are surfaced ONLY through v_vessel_detail,
-- gated identically to owner_company — admin OR the vessel's own owner. No desk
-- email/phone is exposed (those are NULL in the registry anyway); only the
-- desk *label* and public registry facts (IMO, fleet size) flow through.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Durable company-level link columns on the vessel ──
ALTER TABLE public.vessels
  ADD COLUMN IF NOT EXISTS owner_org_id              uuid REFERENCES public.organizations(id),
  ADD COLUMN IF NOT EXISTS manager_org_id            uuid REFERENCES public.organizations(id),
  ADD COLUMN IF NOT EXISTS commercial_manager_org_id uuid REFERENCES public.organizations(id);

CREATE INDEX IF NOT EXISTS idx_vessels_owner_org   ON public.vessels (owner_org_id)   WHERE owner_org_id   IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vessels_manager_org ON public.vessels (manager_org_id) WHERE manager_org_id IS NOT NULL;

-- ── 2. Backfill by exact (case-insensitive) name match — owner + manager ──
UPDATE public.vessels v
   SET owner_org_id = o.id
  FROM public.organizations o
 WHERE v.owner_org_id IS NULL
   AND v.owner_company IS NOT NULL
   AND upper(btrim(v.owner_company)) = upper(o.name);

UPDATE public.vessels v
   SET manager_org_id = o.id
  FROM public.organizations o
 WHERE v.manager_org_id IS NULL
   AND v.manager_company IS NOT NULL
   AND upper(btrim(v.manager_company)) = upper(o.name);

-- commercial_manager_company exists only in the migration schema, not
-- necessarily in prod — backfill it only if the source column is present.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'vessels'
       AND column_name = 'commercial_manager_company'
  ) THEN
    EXECUTE $u$
      UPDATE public.vessels v
         SET commercial_manager_org_id = o.id
        FROM public.organizations o
       WHERE v.commercial_manager_org_id IS NULL
         AND v.commercial_manager_company IS NOT NULL
         AND upper(btrim(v.commercial_manager_company)) = upper(o.name)
    $u$;
  END IF;
END $$;

-- ── 3. Re-publish the masked detail view with the gated org link + registry ──
-- Byte-faithful to …000600 (same 31 non-PII cols, same 12 gated PII cols, same
-- gate g and sanctioned WHERE) plus the org-link columns and public registry
-- facts for the owning / managing firm — all behind the same gate g.
DROP VIEW IF EXISTS public.v_vessel_detail;
CREATE VIEW public.v_vessel_detail AS
SELECT
  v.id, v.vessel_name, v.imo_number, v.vessel_type, v.dwt_grain, v.dwt_bale,
  v.build_year, v.flag, v.flag_category, v.scope, v.risk_level, v.risk_notes,
  v.preferred_zones, v.trading_zone_raw, v.is_geared, v.crane_count,
  v.crane_swl_mt, v.grain_certified, v.dg_certified, v.max_loa_m, v.max_draft_m,
  v.pi_club, v.is_sanctioned, v.notes, v.created_at, v.updated_at, v.dwcc,
  v.grain_cbm, v.bale_cbm, v.lat, v.lng,
  CASE WHEN g THEN v.owner_company    END AS owner_company,
  CASE WHEN g THEN v.owner_country    END AS owner_country,
  CASE WHEN g THEN v.owner_address    END AS owner_address,
  CASE WHEN g THEN v.manager_company  END AS manager_company,
  CASE WHEN g THEN v.manager_country  END AS manager_country,
  CASE WHEN g THEN v.manager_address  END AS manager_address,
  CASE WHEN g THEN v.pic_name         END AS pic_name,
  CASE WHEN g THEN v.pic_role         END AS pic_role,
  CASE WHEN g THEN v.phone            END AS phone,
  CASE WHEN g THEN v.email_general    END AS email_general,
  CASE WHEN g THEN v.email_chartering END AS email_chartering,
  CASE WHEN g THEN v.website          END AS website,
  -- org link + public registry facts (no contact PII) — same gate g
  CASE WHEN g THEN v.owner_org_id        END AS owner_org_id,
  CASE WHEN g THEN oo.name               END AS owner_org_name,
  CASE WHEN g THEN oo.imo                END AS owner_org_imo,
  CASE WHEN g THEN oo.country            END AS owner_org_country,
  CASE WHEN g THEN oo.fleet_total        END AS owner_org_fleet,
  CASE WHEN g THEN oo.desk_contact_name  END AS owner_org_desk,
  CASE WHEN g THEN v.manager_org_id      END AS manager_org_id,
  CASE WHEN g THEN mo.name               END AS manager_org_name,
  CASE WHEN g THEN mo.fleet_total        END AS manager_org_fleet,
  CASE WHEN g THEN mo.desk_contact_name  END AS manager_org_desk
FROM public.vessels v
LEFT JOIN public.organizations oo ON oo.id = v.owner_org_id
LEFT JOIN public.organizations mo ON mo.id = v.manager_org_id
CROSS JOIN LATERAL (
  SELECT (public.fn_is_admin() OR public.fn_owns_vessel(v.id)) AS g
) gate
WHERE NOT v.is_sanctioned OR public.fn_is_admin();

GRANT SELECT ON public.v_vessel_detail TO authenticated;
