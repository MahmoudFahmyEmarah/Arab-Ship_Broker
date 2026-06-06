import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import { SettingsBoard } from "@/components/portal/SettingsBoard";

export const metadata = {
  title: "Account Settings — Arab ShipBroker",
};

export default async function AccountSettingsPage() {
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
  if (!user) redirect("/auth/login");

  // role + created_at aren't on the dashboard-context account object, so load
  // them here and pass to the (client) design board.
  const { data: appUser } = await supabase
    .from("users")
    .select("role, created_at")
    .eq("id", user.id)
    .single();

  const row = appUser as { role: string | null; created_at: string | null } | null;
  const memberSince = row?.created_at
    ? new Date(row.created_at).toLocaleDateString("en-GB", { month: "long", year: "numeric" })
    : null;

  return <SettingsBoard role={row?.role ?? null} memberSince={memberSince} />;
}
