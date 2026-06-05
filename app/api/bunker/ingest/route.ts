import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Credentialed bunker-price ingestion channel.
//
// Registered suppliers seed their daily/weekly prices here with the username +
// password we provision (admin → /admin/bunker). Auth + insert happen inside the
// bunker_ingest() SECURITY DEFINER RPC, so this route holds no secret and uses no
// service-role key. Credentials may be sent as HTTP Basic auth or in the body.
//
//   POST /api/bunker/ingest
//   Authorization: Basic base64(username:password)   (or {username,password} in body)
//   { "prices": [ { "fuel":"VLSFO","value":1183,"dir":"down","port":"Fujairah" }, … ] }
//
//   → 200 { ok:true, inserted:N }  ·  401 { ok:false, error:"invalid_credentials" }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  let username: string | undefined;
  let password: string | undefined;

  const auth = req.headers.get("authorization") || "";
  if (auth.startsWith("Basic ")) {
    const [u, p] = Buffer.from(auth.slice(6), "base64").toString("utf8").split(":");
    username = u;
    password = p;
  } else {
    username = typeof body.username === "string" ? body.username : undefined;
    password = typeof body.password === "string" ? body.password : undefined;
  }
  const prices = Array.isArray(body.prices) ? body.prices : [];

  if (!username || !password) {
    return NextResponse.json({ ok: false, error: "missing_credentials" }, { status: 401 });
  }
  if (prices.length === 0) {
    return NextResponse.json({ ok: false, error: "no_prices" }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  const { data, error } = await supabase.rpc("bunker_ingest", {
    p_username: username,
    p_secret: password,
    p_prices: prices,
  });
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }
  const result = (data ?? { ok: false }) as { ok: boolean; error?: string };
  return NextResponse.json(result, { status: result.ok ? 200 : 401 });
}
