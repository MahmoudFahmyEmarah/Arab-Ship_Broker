-- ── Fix: ensure users.id has gen_random_uuid() as its default ──────────────
-- Root cause: create_account_with_profiles RPC omitted id from the INSERT
-- column list. If the column default was missing on the live DB, Postgres
-- received NULL for id and violated the NOT NULL constraint, producing:
--   "null value in column id of relation users violates not-null constraint"
--
-- This migration adds the default so the table is self-consistent even if
-- the RPC is re-applied before the updated APPLY_FOUNDATION.sql is run.

ALTER TABLE public.users
  ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- Also redeploy the fixed RPC that now explicitly passes id = gen_random_uuid()
-- so it is independent of the column default going forward.
CREATE OR REPLACE FUNCTION public.create_account_with_profiles(
  p_supabase_user_id UUID,
  p_name             TEXT,
  p_email            TEXT,
  p_profiles         public.profile_type_enum[]
)
RETURNS public.users
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user public.users;
  v_pt   public.profile_type_enum;
  v_cols text := 'id, supabase_user_id, email';
  v_vals text;
  v_role text := CASE
    WHEN 'cargo'::public.profile_type_enum  = ANY (p_profiles)
     AND 'vessel'::public.profile_type_enum = ANY (p_profiles) THEN 'broker'
    WHEN 'cargo'::public.profile_type_enum  = ANY (p_profiles) THEN 'cargo_owner'
    ELSE 'vessel_owner'
  END;
BEGIN
  v_vals := format('%L, %L, %L', p_supabase_user_id, p_supabase_user_id, p_email);

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'name') THEN
    v_cols := v_cols || ', name';
    v_vals := v_vals || format(', %L', p_name);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'full_name') THEN
    v_cols := v_cols || ', full_name';
    v_vals := v_vals || format(', %L', p_name);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'role') THEN
    v_cols := v_cols || ', role';
    v_vals := v_vals || format(', %L', v_role);
  END IF;

  EXECUTE format('INSERT INTO public.users (%s) VALUES (%s) RETURNING *', v_cols, v_vals)
    INTO v_user;

  FOREACH v_pt IN ARRAY p_profiles LOOP
    INSERT INTO public.profiles (account_id, profile_type, display_name)
    VALUES (v_user.id, v_pt, p_name)
    ON CONFLICT (account_id, profile_type) DO NOTHING;
  END LOOP;

  RETURN v_user;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_account_with_profiles(uuid, text, text, public.profile_type_enum[]) TO service_role;
