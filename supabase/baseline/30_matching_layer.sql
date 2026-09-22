-- ════════════════════════════════════════════════════════════════════════
-- The matching layer — created outside migration history (21 Sep 2026)
--
-- Inventory of 21 Sep 2026: seven functions, one view and three triggers that
-- the deployed schema has and NO migration creates. They were written
-- directly against the database before the 20260616 remote baseline was
-- introspected, and introspection records tables and columns rather than the
-- statements that made them.
--
-- This is not a cosmetic gap. 20260910100000_port_identity_layer.sql runs
--     alter table public.cargo_listings disable trigger trg_matches_on_cargo;
-- so a rebuild from migrations alone stops there, on migration 75 of 111.
--
-- Applied by scripts/db-rebuild.sh immediately after the remote baseline,
-- because these objects depend on the tables it creates and the migration
-- above depends on them. Bodies are exactly as deployed.
--
-- Not a migration: on the live project every one of these already exists.
-- Idempotent (create or replace).
-- ════════════════════════════════════════════════════════════════════════

-- ── the view the matcher reads ──────────────────────────────────────────
CREATE OR REPLACE VIEW "public"."v_eligible_matches" AS
 SELECT "cargo_id",
    "vessel_avail_id",
        CASE
            WHEN ("score" >= 4) THEN 'Strong'::"text"
            WHEN ("score" >= 3) THEN 'Good'::"text"
            ELSE 'Possible'::"text"
        END AS "score_label"
   FROM ( SELECT "cl"."id" AS "cargo_id",
            "va"."id" AS "vessel_avail_id",
            ((
                CASE
                    WHEN (((("cl"."qty_max_mt")::numeric / (NULLIF("v"."dwt_grain", 0))::numeric) >= 0.9) AND ((("cl"."qty_max_mt")::numeric / (NULLIF("v"."dwt_grain", 0))::numeric) <= 1.0)) THEN 2
                    WHEN (((("cl"."qty_max_mt")::numeric / (NULLIF("v"."dwt_grain", 0))::numeric) >= 0.8) AND ((("cl"."qty_max_mt")::numeric / (NULLIF("v"."dwt_grain", 0))::numeric) <= 1.1)) THEN 1
                    ELSE 0
                END +
                CASE
                    WHEN (("va"."open_zone")::"text" = ("cl"."load_zone")::"text") THEN 2
                    WHEN (("va"."open_zone")::"text" = ("cl"."disch_zone")::"text") THEN 1
                    ELSE 0
                END) +
                CASE
                    WHEN (("cl"."requires_geared" IS NOT TRUE) OR COALESCE("v"."is_geared", false)) THEN 1
                    ELSE 0
                END) AS "score"
           FROM (("public"."cargo_listings" "cl"
             JOIN "public"."vessel_availability" "va" ON ((("va"."open_zone" IS NOT NULL) AND ((("va"."open_zone")::"text" = ("cl"."load_zone")::"text") OR (("va"."open_zone")::"text" = ("cl"."disch_zone")::"text")))))
             JOIN "public"."vessels" "v" ON (("v"."id" = "va"."vessel_id")))
          WHERE ((("cl"."review_status")::"text" = 'APPROVED'::"text") AND (("cl"."status")::"text" = ANY (ARRAY['IN'::"text", 'PARTIAL'::"text"])) AND (("va"."status")::"text" = 'OPEN'::"text") AND (("va"."review_status")::"text" = 'APPROVED'::"text") AND ("v"."is_sanctioned" = false) AND ("v"."dwt_grain" IS NOT NULL) AND
                CASE
                    WHEN "va"."accepts_part_cargo" THEN (("v"."dwt_grain" >= "cl"."qty_min_mt") AND (("v"."dwt_grain")::numeric <= (("cl"."qty_max_mt")::numeric * 1.20)) AND (("v"."dwt_grain")::numeric >= (("cl"."qty_max_mt")::numeric * 0.80)))
                    ELSE (("v"."dwt_grain" >= "cl"."qty_min_mt") AND (("v"."dwt_grain")::numeric <= (("cl"."qty_max_mt")::numeric * 1.10)) AND (("v"."dwt_grain")::numeric >= (("cl"."qty_max_mt")::numeric * 0.90)))
                END AND ((("cl"."cargo_type")::"text" = 'Break Bulk'::"text") OR (("v"."vessel_type")::"text" = ANY (ARRAY['Bulk Carrier'::"text", 'General Cargo'::"text"]))) AND (("cl"."is_spot" = true) OR (("va"."open_date" IS NOT NULL) AND ("cl"."laycan_from" IS NOT NULL) AND (("va"."open_date" >= (("cl"."laycan_from" - '21 days'::interval))::"date") AND ("va"."open_date" <= (("cl"."laycan_from" + '14 days'::interval))::"date")))) AND (("cl"."requires_geared" IS NULL) OR ("cl"."requires_geared" = false) OR ("v"."is_geared" = true)) AND (("cl"."is_grain_cargo" = false) OR (COALESCE("v"."grain_certified", false) = true)) AND (("cl"."is_dg_cargo" = false) OR (COALESCE("v"."dg_certified", false) = true)) AND (("cl"."max_vessel_age_yr" IS NULL) OR ("v"."build_year" IS NULL) OR (((EXTRACT(year FROM "now"()))::integer - "v"."build_year") <= "cl"."max_vessel_age_yr")) AND (("cl"."max_draft_m" IS NULL) OR ("v"."max_draft_m" IS NULL) OR ("v"."max_draft_m" <= "cl"."max_draft_m")) AND (("cl"."max_loa_m" IS NULL) OR ("v"."max_loa_m" IS NULL) OR ("v"."max_loa_m" <= "cl"."max_loa_m")))) "s";

-- ── the functions ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION "public"."fn_coerce_vessel_type"("p" "text") RETURNS "public"."vessel_type_enum"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select case
    when p is null then 'Bulk Carrier'
    when p ilike '%bulk%' then 'Bulk Carrier'
    when p ilike '%general%' or p ilike '%mpp%' or p ilike '%multi%' or p ilike '%cargo%' then 'General Cargo'
    else 'Bulk Carrier' end::public.vessel_type_enum;
$$;

CREATE OR REPLACE FUNCTION "public"."fn_refresh_matches_for_cargo"("p_cargo_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  delete from public.matches where cargo_id = p_cargo_id;
  insert into public.matches (cargo_id, vessel_avail_id, score_label, computed_at)
  select cargo_id, vessel_avail_id, score_label, now()
  from public.v_eligible_matches where cargo_id = p_cargo_id;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."fn_refresh_matches_for_availability"("p_availability_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  delete from public.matches where vessel_avail_id = p_availability_id;
  insert into public.matches (cargo_id, vessel_avail_id, score_label, computed_at)
  select cargo_id, vessel_avail_id, score_label, now()
  from public.v_eligible_matches where vessel_avail_id = p_availability_id;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."fn_refresh_matches"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare n integer;
begin
  delete from public.matches;
  insert into public.matches (cargo_id, vessel_avail_id, score_label, computed_at)
  select cargo_id, vessel_avail_id, score_label, now() from public.v_eligible_matches;
  get diagnostics n = row_count;
  return n;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."trg_refresh_matches_cargo"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if tg_op = 'DELETE' then
    delete from public.matches where cargo_id = old.id;
    return old;
  end if;
  perform public.fn_refresh_matches_for_cargo(new.id);
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."trg_refresh_matches_availability"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if tg_op = 'DELETE' then
    delete from public.matches where vessel_avail_id = old.id;
    return old;
  end if;
  perform public.fn_refresh_matches_for_availability(new.id);
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."trg_refresh_matches_vessel"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare r record;
begin
  for r in select id from public.vessel_availability where vessel_id = new.id loop
    perform public.fn_refresh_matches_for_availability(r.id);
  end loop;
  return new;
end;
$$;

-- ── the triggers that keep matches fresh ────────────────────────────────
CREATE OR REPLACE TRIGGER "trg_matches_on_cargo" AFTER INSERT OR DELETE OR UPDATE ON "public"."cargo_listings" FOR EACH ROW EXECUTE FUNCTION "public"."trg_refresh_matches_cargo"();
CREATE OR REPLACE TRIGGER "trg_matches_on_availability" AFTER INSERT OR DELETE OR UPDATE ON "public"."vessel_availability" FOR EACH ROW EXECUTE FUNCTION "public"."trg_refresh_matches_availability"();
CREATE OR REPLACE TRIGGER "trg_matches_on_vessel" AFTER UPDATE ON "public"."vessels" FOR EACH ROW EXECUTE FUNCTION "public"."trg_refresh_matches_vessel"();

do $$
declare v_missing text := '';
begin
  if to_regprocedure('public.fn_refresh_matches_for_cargo(uuid)') is null then v_missing := v_missing || 'fn_refresh_matches_for_cargo '; end if;
  if to_regclass('public.v_eligible_matches') is null then v_missing := v_missing || 'v_eligible_matches '; end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_matches_on_cargo') then v_missing := v_missing || 'trg_matches_on_cargo '; end if;
  if v_missing <> '' then raise exception 'matching layer incomplete: %', v_missing; end if;
  raise notice 'matching layer present (functions, view, triggers)';
end $$;
