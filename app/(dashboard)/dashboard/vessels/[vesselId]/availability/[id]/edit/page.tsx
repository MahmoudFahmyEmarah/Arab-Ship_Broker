import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { AvailabilityForm } from "@/components/vessels/AvailabilityForm";
import { VesselAvailabilityRow, VesselRow } from "@/lib/schemas/vessel";

export default async function EditAvailabilityPage({
  params,
}: {
  params: Promise<{ vesselId: string; id: string }>;
}) {
  const { vesselId, id } = await params;
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

  const { data: ownership } = await supabase
    .from("listing_ownership")
    .select("role")
    .eq("listing_id", id)
    .eq("owner_user_id", user.id)
    .eq("listing_type", "vessel_availability")
    .eq("is_current", true)
    .single();

  if (!ownership) notFound();

  const { data: availability } = await supabase
    .from("vessel_availability")
    .select(
      `*, vessel:vessels (
      vessel_name, imo_number, vessel_type, dwt_grain, dwt_bale,
      build_year, flag, scope, risk_level, is_geared, grain_certified,
      dg_certified, max_loa_m, max_draft_m, is_sanctioned
    )`,
    )
    .eq("id", id)
    .single();

  if (!availability) notFound();

  const listing = availability as VesselAvailabilityRow & { vessel: VesselRow };

  if (listing.vessel_id !== vesselId) {
    redirect(`/dashboard/vessels/${listing.vessel_id}/availability/${id}/edit`);
  }

  if (listing.status === "FIXED" || listing.status === "INACTIVE") {
    redirect(`/dashboard/vessels/${vesselId}/availability/${id}`);
  }

  return (
    <div className="py-2 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-asb-navy">Edit position</h1>
        <p className="text-sm text-asb-gray-500 mt-1">
          {listing.vessel.vessel_name}
          {listing.open_port_name ? (
            <>
              {" · Open "}
              {listing.open_port_locode ? (
                <Link
                  href={`/dashboard/ports/${listing.open_port_locode}`}
                  className="hover:text-asb-blue hover:underline"
                >
                  {listing.open_port_name}
                </Link>
              ) : (
                listing.open_port_name
              )}
            </>
          ) : (
            ""
          )}
          {listing.open_date ? ` · ${listing.open_date}` : ""}
        </p>
      </div>
      <AvailabilityForm initialData={listing} mode="edit" />
    </div>
  );
}
