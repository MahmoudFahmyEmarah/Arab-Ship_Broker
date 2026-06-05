import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Server-component Supabase client (read-only cookie access), matching the
// inline pattern already used across the app's server pages/actions.
export async function getSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {},
      },
    },
  );
}
