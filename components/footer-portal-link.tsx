"use client";

// Auth-aware Portal link for the public footer. Mirrors the Navbar's session
// check (getSupabaseBrowserClient + onAuthStateChange): a signed-in visitor is
// sent to the dashboard; a logged-out visitor is routed to sign-in / get-access
// — never dropped at a dead login wall. Styled identically to the other
// Quick Links.
import { useEffect, useState } from "react";
import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

const LINK_CLASS =
  "text-ocean-200/80 hover:text-foam-300 transition-colors text-sm w-fit focus:outline-none focus-visible:ring-2 focus-visible:ring-foam-400 rounded-sm";

export function FooterPortalLink() {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    supabase.auth.getSession().then(({ data: { session } }) => setUser(session?.user ?? null));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => subscription.unsubscribe();
  }, []);

  return (
    <Link href={user ? "/dashboard" : "/auth/login"} className={LINK_CLASS}>
      Portal
    </Link>
  );
}
