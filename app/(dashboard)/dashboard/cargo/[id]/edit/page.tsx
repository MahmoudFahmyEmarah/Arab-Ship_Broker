import { notFound, redirect } from "next/navigation";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { CargoForm } from "@/components/cargo/CargoForm";
import { CargoListingRow } from "@/lib/schemas/cargo";

export default async function EditCargoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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
    .eq("listing_type", "cargo")
    .eq("is_current", true)
    .single();

  if (!ownership) notFound();

  const { data: cargo, error } = await supabase
    .from("cargo_listings")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !cargo) notFound();

  const listing = cargo as CargoListingRow;

  if (listing.status === "CLOSED") {
    redirect(`/dashboard/cargo/${id}`);
  }

  return (
    <div className="px-6 py-6 md:px-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-asb-navy">
          Edit Cargo Listing
        </h1>
        <p className="text-sm text-asb-gray-500 mt-1">
          {listing.commodity_name} · {listing.ref ?? id}
        </p>
      </div>
      <CargoForm initialData={listing} mode="edit" />
    </div>
  );
}
