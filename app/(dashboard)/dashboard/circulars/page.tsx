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
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-6 md:px-8">
      <div className="flex items-start gap-3">
        <span
          className="inline-flex shrink-0 items-center justify-center"
          style={{ width: 28, height: 28, borderRadius: 6, background: "var(--asb-blue-light)", color: "var(--asb-blue)" }}
        >
          <Sparkles className="h-4 w-4" />
        </span>
        <div>
          <h1 className="page-title">Circular Parser</h1>
          <p style={{ marginTop: 2, fontSize: 12, color: "var(--asb-gray-500)", maxWidth: 640, lineHeight: 1.5 }}>
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
