import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { AvailabilityForm } from "@/components/vessels/AvailabilityForm";
import { ProfileGuard } from "@/components/ProfileGuard";
import { getClaimedVesselById } from "@/sdk/app/vessels";

interface PageProps {
  params: Promise<{ vesselId: string }>;
}

export default async function NewAvailabilityPage({ params }: PageProps) {
  const { vesselId } = await params;
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (!UUID_RE.test(vesselId)) notFound();

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

  const prefilledVessel = await getClaimedVesselById(supabase, vesselId);
  if (!prefilledVessel) notFound();

  return (
    <ProfileGuard requires="vessel">
      <div className="px-6 py-6 md:px-8 space-y-6">
        <div className="flex items-start gap-3">
          <Link
            href={`/dashboard/vessels/${prefilledVessel.id}`}
            className="mt-1 p-2 rounded text-asb-gray-400 hover:text-asb-gray-700 hover:bg-asb-gray-100 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-asb-navy">Post Position</h1>
            <p className="text-sm text-asb-gray-500 mt-1">
              Select your vessel, choose an open port, and submit for matching.
            </p>
          </div>
        </div>

        <AvailabilityForm mode="create" prefilledVessel={prefilledVessel} />
      </div>
    </ProfileGuard>
  );
}
