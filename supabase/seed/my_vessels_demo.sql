-- ════════════════════════════════════════════════════════════════════
-- My Vessels — demo fleet seed (deployment restore · 08_deployment_restore §1)
--
-- WHY THIS EXISTS
--   The My Vessels board (app/(dashboard)/dashboard/vessels) reads the signed-in
--   user's OWN vessel positions (vessel_availability via listing_ownership). On a
--   fresh account that owns nothing, the board is empty *by design* — that is not
--   a bug and not lost UI. The approved design (A-design-target.png) shows a
--   populated, "worked" board, so STAGING should carry demo data. This script
--   restores the prototype's 6-vessel fleet for one demo owner.
--
-- WHAT IT CREATES (idempotent — safe to re-run; upserts by IMO)
--   3 OPEN vessels (full specs + fuel + open position, review_status APPROVED)
--   3 REVIEW vessels (registry identity only, no position, review_status PENDING)
--   + one vessel_availability + listing_ownership(primary) per vessel, owned by
--     the demo user resolved from auth.users by email.
--
-- HOW TO RUN
--   1. Set v_email below to the demo owner's login email (defaults to the
--      project owner). The account must already exist in auth.users.
--   2. Run in the Supabase SQL editor (or psql) AS the DB owner / service role.
--   3. Reload /dashboard/vessels — the board + fleet map should populate.
--
-- SAFETY
--   · Append/upsert only; touches no other user's data; no firewall changes.
--   · open_port_locode is set only when the locode exists in `ports` (no FK
--     break); open_port_name/open_zone are written explicitly either way so the
--     cards render even if a port row is missing.
-- ════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_email  TEXT := 'cap.mdawod@hotmail.com';  -- ← demo owner login email
  v_owner  UUID;
  v_vid    UUID;
  v_aid    UUID;
  v_loc    TEXT;

  -- OPEN fleet: name, imo, flag, type, built, dwt, loa, draft, geared,
  --             locode, zone, port_name, open_date, vlsfo_sea, vlsfo_port,
  --             lsmgo_sea, lsmgo_port, preferred_zones
  TYPE t_open IS RECORD (
    name TEXT, imo TEXT, flag TEXT, vtype public.vessel_type_enum, built SMALLINT,
    dwt INT, loa NUMERIC, draft NUMERIC, geared BOOLEAN,
    locode TEXT, zone public.zone_enum, port TEXT, odate DATE,
    vss NUMERIC, vsp NUMERIC, lss NUMERIC, lsp NUMERIC, prefz public.zone_enum[]
  );
  r_open t_open;
  open_fleet t_open[] := ARRAY[
    ROW('ELFRIEDE','9300946','Barbados','General Cargo',2004,10074,139.5,8.21,TRUE,
        'ROCND','B.SEA','Constanta', DATE '2026-06-10',18.5,2.6,0.5,1.3, ARRAY['E.MED']::public.zone_enum[])::t_open,
    ROW('SITHONIA II','9455571','Barbados','Bulk Carrier',2007,8790,119.8,7.46,TRUE,
        'TRISK','E.MED','Iskenderun', DATE '2026-05-31',16.2,2.1,0.5,1.1, ARRAY['E.MED','B.SEA']::public.zone_enum[])::t_open,
    ROW('HIZIR','9396529','St Kitts & Nevis','General Cargo',2007,8128,113.0,7.02,TRUE,
        'EGALY','E.MED','Alexandria', DATE '2026-06-12',15.0,1.9,0.5,1.0, ARRAY['E.MED','R.SEA']::public.zone_enum[])::t_open
  ];

  -- REVIEW fleet (identity only): name, imo, flag, built
  TYPE t_rev IS RECORD (name TEXT, imo TEXT, flag TEXT, built SMALLINT);
  r_rev t_rev;
  rev_fleet t_rev[] := ARRAY[
    ROW('SEA WAVE I','8420426','Not Known',1987)::t_rev,
    ROW('SEA WAVE 2','8318116','St Kitts & Nevis',1985)::t_rev,
    ROW('MO JOUD','8536146','Guinea-Bissau',2007)::t_rev
  ];
BEGIN
  SELECT id INTO v_owner FROM auth.users WHERE lower(email) = lower(v_email);
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'No auth.users row for %, create/sign-in that account first.', v_email;
  END IF;

  -- ── OPEN vessels ──────────────────────────────────────────────────
  FOREACH r_open IN ARRAY open_fleet LOOP
    INSERT INTO public.vessels
      (vessel_name, imo_number, vessel_type, dwt_grain, build_year, flag,
       is_geared, max_loa_m, max_draft_m, preferred_zones, scope, risk_level, is_sanctioned)
    VALUES
      (r_open.name, r_open.imo, r_open.vtype, r_open.dwt, r_open.built, r_open.flag,
       r_open.geared, r_open.loa, r_open.draft, r_open.prefz, 'In Scope', 'CLEAR', FALSE)
    ON CONFLICT (imo_number) DO UPDATE SET
      vessel_name = EXCLUDED.vessel_name, vessel_type = EXCLUDED.vessel_type,
      dwt_grain = EXCLUDED.dwt_grain, build_year = EXCLUDED.build_year, flag = EXCLUDED.flag,
      is_geared = EXCLUDED.is_geared, max_loa_m = EXCLUDED.max_loa_m,
      max_draft_m = EXCLUDED.max_draft_m, preferred_zones = EXCLUDED.preferred_zones
    RETURNING id INTO v_vid;

    -- Reuse an existing owned availability for this vessel if present (re-run),
    -- otherwise create one.
    SELECT va.id INTO v_aid
    FROM public.vessel_availability va
    JOIN public.listing_ownership lo
      ON lo.listing_id = va.id AND lo.listing_type = 'vessel_availability'
     AND lo.is_current = TRUE AND lo.role = 'primary' AND lo.owner_user_id = v_owner
    WHERE va.vessel_id = v_vid
    LIMIT 1;

    v_loc := (SELECT locode FROM public.ports WHERE locode = r_open.locode);  -- NULL if absent

    IF v_aid IS NULL THEN
      INSERT INTO public.vessel_availability
        (vessel_id, open_port_locode, open_date, status, review_status, goes_live_at,
         vlsfo_sea_mt_day, vlsfo_port_mt_day, lsmgo_sea_mt_day, lsmgo_port_mt_day)
      VALUES
        (v_vid, v_loc, r_open.odate, 'OPEN', 'APPROVED', NOW(),
         r_open.vss, r_open.vsp, r_open.lss, r_open.lsp)
      RETURNING id INTO v_aid;

      INSERT INTO public.listing_ownership
        (listing_type, listing_id, owner_user_id, role, transfer_reason)
      VALUES ('vessel_availability', v_aid, v_owner, 'primary', 'initial_post');
    ELSE
      UPDATE public.vessel_availability SET
        open_port_locode = v_loc, open_date = r_open.odate, status = 'OPEN',
        review_status = 'APPROVED', goes_live_at = NOW(),
        vlsfo_sea_mt_day = r_open.vss, vlsfo_port_mt_day = r_open.vsp,
        lsmgo_sea_mt_day = r_open.lss, lsmgo_port_mt_day = r_open.lsp
      WHERE id = v_aid;
    END IF;

    -- Explicit name/zone so cards render even when the locode isn't in `ports`.
    UPDATE public.vessel_availability
       SET open_port_name = r_open.port, open_zone = r_open.zone
     WHERE id = v_aid;
  END LOOP;

  -- ── REVIEW vessels (registry identity only, no declared position) ──
  FOREACH r_rev IN ARRAY rev_fleet LOOP
    INSERT INTO public.vessels
      (vessel_name, imo_number, vessel_type, build_year, flag, scope, risk_level, is_sanctioned)
    VALUES
      (r_rev.name, r_rev.imo, 'General Cargo', r_rev.built, r_rev.flag, 'In Scope', 'CLEAR', FALSE)
    ON CONFLICT (imo_number) DO UPDATE SET
      vessel_name = EXCLUDED.vessel_name, build_year = EXCLUDED.build_year, flag = EXCLUDED.flag
    RETURNING id INTO v_vid;

    SELECT va.id INTO v_aid
    FROM public.vessel_availability va
    JOIN public.listing_ownership lo
      ON lo.listing_id = va.id AND lo.listing_type = 'vessel_availability'
     AND lo.is_current = TRUE AND lo.role = 'primary' AND lo.owner_user_id = v_owner
    WHERE va.vessel_id = v_vid
    LIMIT 1;

    IF v_aid IS NULL THEN
      INSERT INTO public.vessel_availability
        (vessel_id, status, review_status)
      VALUES (v_vid, 'INACTIVE', 'PENDING')
      RETURNING id INTO v_aid;

      INSERT INTO public.listing_ownership
        (listing_type, listing_id, owner_user_id, role, transfer_reason)
      VALUES ('vessel_availability', v_aid, v_owner, 'primary', 'initial_post');
    END IF;
  END LOOP;

  RAISE NOTICE 'Demo fleet seeded for % (3 OPEN + 3 REVIEW).', v_email;
END $$;
