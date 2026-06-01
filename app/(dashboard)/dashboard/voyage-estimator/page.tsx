import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient } from "@supabase/ssr";
import { Calculator } from "lucide-react";
import { VoyageEstimatorCalculator } from "@/components/voyage/VoyageEstimatorCalculator";

export const metadata = {
  title: "Voyage Estimator — Arab ShipBroker",
};

export default async function VoyageEstimatorPage() {
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

  return (
    <div className="mx-auto max-w-5xl space-y-6 py-2">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-ocean-50 p-2">
          <Calculator className="h-5 w-5 text-ocean-600" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Voyage Estimator</h1>
          <p className="mt-1 text-sm text-slate-500">
            Full voyage P&amp;L with per-fuel bunkers (VLSFO &amp; LSMGO, at sea
            and in port). Prefill from an open vessel or a cargo, adjust the
            inputs, and the result updates live. Saved estimates are private to
            you.
          </p>
        </div>
      </div>

      <VoyageEstimatorCalculator />
    </div>
  );
}
