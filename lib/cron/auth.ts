// One rule for every scheduled endpoint (18 Sep 2026, Data Sync hardening
// phase 0): the caller must present `Authorization: Bearer <CRON_SECRET>`.
//
// Vercel sends exactly that header on its own cron invocations whenever the
// CRON_SECRET environment variable is set on the project, so the schedules in
// vercel.json keep working. The `x-vercel-cron` header is NOT trusted any
// more — its presence proved nothing, since any client can add a header —
// and is only read to label the run as "cron" or "manual" in job_runs.
//
// No secret configured: closed in production, open in development so a local
// chain can still re-kick itself (warned once).

let warnedNoSecret = false;

export function cronAuthorized(authorization: string | null | undefined): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") return false;
    if (!warnedNoSecret) {
      warnedNoSecret = true;
      console.warn("[cron] CRON_SECRET is not set — scheduled endpoints are open in development only");
    }
    return true;
  }
  return (authorization ?? "") === `Bearer ${secret}`;
}

/** "cron" when Vercel's scheduler called, "manual" otherwise — a label, never a credential. */
export function cronTrigger(headers: { get(name: string): string | null }): "cron" | "manual" {
  return headers.get("x-vercel-cron") != null ? "cron" : "manual";
}
