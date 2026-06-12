import { getAppUserRow } from "@/lib/app-user";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient } from "@supabase/ssr";

import { normalizeRole } from "@/lib/role";
import { canAccess, type AdminTier, type AdminPerms } from "@/lib/admin/sections";

export type AdminUser = {
  supabaseUserId: string;
  rowId: string; // public.users.id (NOT the auth uid — they differ)
  email: string;
  fullName: string;
  tier: AdminTier;
  perms: AdminPerms | null;
};

// Gate an admin surface. With { section }, sub-admins without access to that
// section are bounced to the admin dashboard (the design's "bounce when an
// inaccessible page is reached"); with { edit: true } view-only access bounces
// too — mutating server actions pass it so a 'view' seat can never write.
export async function requireAdmin(
  opts: { section?: string; edit?: boolean } = {},
): Promise<AdminUser> {
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {},
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  const appUser = await getAppUserRow<{
    full_name: string | null; email: string; role: string; is_active: boolean;
    admin_tier?: string | null; admin_perms?: AdminPerms | null;
  }>(supabase, user.id, "full_name, email, role, is_active, admin_tier, admin_perms");

  if (!appUser || normalizeRole(appUser.role) !== "admin") {
    redirect(appUser ? "/dashboard" : "/auth/login");
  }

  if (!appUser.is_active) {
    redirect("/auth/login?error=account_suspended");
  }

  // Admins predating the sub model (or rows the migration hasn't touched yet)
  // are the owner — treat a NULL tier on an admin row as 'super'.
  const tier = ((appUser as { admin_tier?: string | null }).admin_tier ?? "super") as AdminTier;
  const perms = ((appUser as { admin_perms?: AdminPerms | null }).admin_perms ?? null);

  if (opts.section) {
    const access = canAccess(opts.section, tier, perms);
    if (access === "none" || (opts.edit && access !== "edit")) {
      redirect("/admin/dashboard");
    }
  }

  return {
    supabaseUserId: user.id,
    rowId: appUser.id,
    email: appUser.email,
    fullName: appUser.full_name ?? "Admin",
    tier,
    perms,
  };
}

export async function getAdminSupabaseClient() {
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
