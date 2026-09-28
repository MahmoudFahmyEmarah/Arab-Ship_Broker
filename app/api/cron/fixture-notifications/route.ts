import { NextRequest, NextResponse } from "next/server";
import { cronAuthorized, cronTrigger } from "@/lib/cron/auth";
import { withJobRunStrict } from "@/lib/jobs/runs";
import { dispatchNotificationDeliveries } from "@/lib/notifications/dispatch";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

async function run(req: NextRequest) {
  if (!cronAuthorized(req.headers.get("authorization"))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const client = getSupabaseAdminClient();
  try {
    const { result, finalization } = await withJobRunStrict(
      client,
      "fixture-notifications",
      { trigger: cronTrigger(req.headers), retries: 2 },
      async () => {
        const dispatch = await dispatchNotificationDeliveries(client, {
          // Two sequential SMTP attempts remain inside the 60-second route
          // budget even when the transport reaches its socket timeout.
          limit: 2,
          leaseSeconds: 180,
          maxAttempts: 8,
          siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? null,
        });
        return { result: dispatch, rows: dispatch.sent, meta: { ...dispatch } };
      },
    );
    if (!finalization.persisted) {
      return NextResponse.json(
        { ok: false, error: "dispatch completed but its audit record did not persist", result },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[fixture-notifications] dispatch failed", error);
    return NextResponse.json({ ok: false, error: "notification dispatch failed" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return run(req);
}

export async function POST(req: NextRequest) {
  return run(req);
}
