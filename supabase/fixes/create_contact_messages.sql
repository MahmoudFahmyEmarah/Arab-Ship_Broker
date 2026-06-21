-- ════════════════════════════════════════════════════════════════════
-- FIX: create the missing `contact_messages` table on the live database.
--
-- The public Contact form (app/(public)/contact/page.tsx → sdk/app/contact.ts)
-- inserts each submission into public.contact_messages; admins read them in the
-- admin console → Contact Messages. That table was never created on the live DB
-- (schema drift), so every "Send Message" currently fails with
--   "Could not find the table 'public.contact_messages' in the schema cache".
--
-- This recreates it exactly as the original migration intended:
--   • anon + authenticated may INSERT (the public form)
--   • only admins may SELECT / UPDATE / DELETE
-- Plain text columns (no enums) → no further drift risk. Idempotent.
-- Run once in the Supabase SQL editor.
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.contact_messages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  email               text NOT NULL,
  phone               text,
  how_did_you_find_us text,
  message             text NOT NULL,
  is_read             boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can insert contact messages" ON public.contact_messages;
CREATE POLICY "Anyone can insert contact messages"
  ON public.contact_messages FOR INSERT TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Admins can view contact messages" ON public.contact_messages;
CREATE POLICY "Admins can view contact messages"
  ON public.contact_messages FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can update contact messages" ON public.contact_messages;
CREATE POLICY "Admins can update contact messages"
  ON public.contact_messages FOR UPDATE TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can delete contact messages" ON public.contact_messages;
CREATE POLICY "Admins can delete contact messages"
  ON public.contact_messages FOR DELETE TO authenticated
  USING (public.is_admin());

GRANT INSERT ON public.contact_messages TO anon, authenticated;
GRANT SELECT, UPDATE, DELETE ON public.contact_messages TO authenticated;
GRANT ALL ON public.contact_messages TO service_role;

NOTIFY pgrst, 'reload schema';
