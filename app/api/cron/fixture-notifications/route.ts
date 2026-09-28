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
  // Leave 15 seconds for the claim settlement and job-run finalisation inside
  // the platform's 60-second function limit.
  const deadlineAt = Date.now() + 45_000;
  try {
    const { result, finalization } = await withJobRunStrict(
      client,
      "fixture-notifications",
      { trigger: cronTrigger(req.headers), retries: 2 },
      async () => {
        const dispatch = await dispatchNotificationDeliveries(client, {
          // One bounded SMTP attempt per invocation. Claiming more would lease
          // work that cannot safely finish before the route deadline.
          limit: 1,
          leaseSeconds: 180,
          maxAttempts: 8,
          siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? null,
          deadlineAt,
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
