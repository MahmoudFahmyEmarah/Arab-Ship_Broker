import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient } from "@supabase/ssr";

export type AdminUser = {
  supabaseUserId: string;
  email: string;
  fullName: string;
};

export async function requireAdmin(): Promise<AdminUser> {
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

  const { data: appUser } = await supabase
    .from("users")
    .select("full_name, email, role, is_active")
    .eq("id", user.id)
    .single();

  if (!appUser || appUser.role !== "admin") {
    redirect(appUser ? "/dashboard" : "/auth/login");
  }

  if (!appUser.is_active) {
    redirect("/auth/login?error=account_suspended");
  }

  return {
    supabaseUserId: user.id,
    email: appUser.email,
    fullName: appUser.full_name ?? "Admin",
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
