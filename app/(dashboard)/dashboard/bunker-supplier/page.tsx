import Link from "next/link";
import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { SupplierPortal } from "@/components/bunker/SupplierPortal";
import type { SupplierPortalState } from "@/lib/bunker/supplier";
import "@/components/bunker/bunker-supplier.css";

export const metadata = { title: "Bunker prices · Arab ShipBroker" };
export const dynamic = "force-dynamic";

// Supplier portal: members linked to a bunker supplier (by admin invitation)
// publish and refresh their price table here. Everyone else sees how to join.
export default async function BunkerSupplierPage() {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data, error } = await supabase.rpc("supplier_list_my_quotes");
  const state = data as SupplierPortalState | null;

  if (error || !state || state.suppliers.length === 0) {
    return (
      <div className="bks">
        <header className="bks__head">
          <h1 className="bks__title">Bunker prices</h1>
          <p className="bks__sub">For first-hand physical bunker suppliers.</p>
        </header>
        <section className="bks-card">
          <p>
            Supplier access is by invitation. Publishing your prices here puts your name on the bunker
            ticker that brokers and owners see across the platform.
          </p>
          <Link className="bks-btn bks-btn--primary" href="/contact">Contact us to join</Link>
        </section>
      </div>
    );
  }

  return <SupplierPortal state={state} />;
}
