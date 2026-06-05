import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { Ship } from "lucide-react";

import { VesselCreateForm } from "@/components/vessels/VesselCreateForm";
import { ProfileGuard } from "@/components/ProfileGuard";

export const metadata = {
  title: "Register Vessel — Arab ShipBroker",
};

export default async function RegisterVesselPage() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: appUser } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  const canAccessVesselPages =
    appUser?.role === "vessel_owner" || appUser?.role === "broker";

  if (!canAccessVesselPages) redirect("/dashboard");

  return (
    <ProfileGuard requires="vessel">
      <div className="px-6 py-6 md:px-8 space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded bg-asb-blue-light border border-asb-gray-200 flex items-center justify-center shrink-0">
            <Ship className="w-5 h-5 text-asb-blue" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-asb-navy">
              Register a vessel
            </h1>
            <p className="text-sm text-asb-gray-500 mt-0.5">
              Add your vessel to the Arab ShipBroker intelligence register. Once
              registered, you can post its operational availability.
            </p>
          </div>
        </div>

        <VesselCreateForm />
      </div>
    </ProfileGuard>
  );
}
