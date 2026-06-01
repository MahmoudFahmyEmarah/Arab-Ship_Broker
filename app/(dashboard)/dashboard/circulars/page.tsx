import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient } from "@supabase/ssr";
import { Sparkles } from "lucide-react";
import { CircularParser } from "@/components/circulars/CircularParser";

export const metadata = {
  title: "Circular Parser — Arab ShipBroker",
};

export default async function CircularsPage() {
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
    <div className="mx-auto max-w-3xl space-y-6 py-2">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-asb-blue-light p-2">
          <Sparkles className="h-5 w-5 text-asb-blue" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-asb-navy">Circular Parser</h1>
          <p className="mt-1 text-sm text-asb-gray-500">
            Paste a cargo or vessel circular from email or WhatsApp. The parser
            reads maritime shorthand and extracts structured data for posting —
            it never reads or reveals any counterparty&apos;s contact details.
          </p>
        </div>
      </div>

      <CircularParser />
    </div>
  );
}
