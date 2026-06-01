import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { Shield } from "lucide-react";

import { AccountEditForm } from "@/components/account/AccountEditForm";

export const metadata = {
  title: "Account Settings — Arab ShipBroker",
};

type ProfileRow = {
  profile_type: "cargo" | "vessel";
  display_name: string | null;
  company: string | null;
  phone: string | null;
  notes: string | null;
  is_active: boolean;
};

type UserRow = {
  full_name: string | null;
  email: string | null;
  is_active: boolean;
  created_at: string;
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

  const { data: appUser } = await supabase
    .from("users")
    .select("id, full_name, email, is_active, created_at")
    .eq("supabase_user_id", user.id)
    .single();

  if (!appUser) redirect("/auth/login");

  const { data: profileData } = await supabase
    .from("profiles")
    .select("profile_type, display_name, company, phone, notes, is_active")
    .eq("account_id", appUser.id);

  const profiles = (profileData ?? []) as ProfileRow[];
  const cargoProfile = profiles.find((p) => p.profile_type === "cargo") ?? null;
  const vesselProfile =
    profiles.find((p) => p.profile_type === "vessel") ?? null;

  const u = appUser as UserRow;

  return (
    <div className="max-w-2xl space-y-8 py-2">
      <div>
        <h1 className="text-2xl font-bold text-asb-navy">Account Settings</h1>
        <p className="text-asb-gray-500 text-sm mt-1">
          Manage your identity, contact details and security.
        </p>
      </div>

      <div className="bg-white border border-asb-gray-200 rounded p-5">
        <p className="text-xs font-bold text-asb-gray-400 uppercase tracking-wider mb-4 pb-3 border-b border-asb-gray-100">
          Account status
        </p>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-asb-gray-400" />
            <span className="text-sm text-asb-gray-700 font-medium">Status:</span>
            <span
              className={`text-xs font-bold px-2.5 py-0.5 rounded-full border ${
                u.is_active
                  ? "bg-green-50 text-green-700 border-green-200"
                  : "bg-asb-gray-100 text-asb-gray-500 border-asb-gray-200"
              }`}
            >
              {u.is_active ? "Active" : "Inactive"}
            </span>
          </div>
          <div className="ml-auto text-xs text-asb-gray-400">
            Member since{" "}
            {new Date(u.created_at).toLocaleDateString("en-GB", {
              month: "long",
              year: "numeric",
            })}
          </div>
        </div>
      </div>

      <AccountEditForm
        initialValues={{
          full_name: u.full_name ?? "",
          email: user.email ?? "",
          cargo: cargoProfile
            ? {
                display_name: cargoProfile.display_name ?? "",
                company: cargoProfile.company ?? "",
                phone: cargoProfile.phone ?? "",
                notes: cargoProfile.notes ?? "",
              }
            : null,
          vessel: vesselProfile
            ? {
                display_name: vesselProfile.display_name ?? "",
                company: vesselProfile.company ?? "",
                phone: vesselProfile.phone ?? "",
                notes: vesselProfile.notes ?? "",
              }
            : null,
        }}
      />
    </div>
  );
}
