import type { SupabaseClient } from "@supabase/supabase-js";

import { E2ETargetError, type E2ETarget } from "./e2e-db";

type CreateUserAttributes = Parameters<SupabaseClient["auth"]["admin"]["createUser"]>[0];
const APPROVED_STAGING_ORIGIN = "https://sidcsytgqalqacsgyguz.supabase.co";

function exactOrigin(raw: unknown, subject: string): string {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new E2ETargetError(`${subject} has no API origin`);
  }
  try {
    const url = new URL(raw);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:")
      || url.origin === "null"
      || url.username !== ""
      || url.password !== ""
      || url.pathname !== "/"
      || url.search !== ""
      || url.hash !== ""
    ) {
      throw new Error("unsupported protocol");
    }
    return url.origin;
  } catch {
    throw new E2ETargetError(`${subject} has an invalid API origin`);
  }
}

function isApprovedTestOrigin(origin: string): boolean {
  const url = new URL(origin);
  const loopback = url.protocol === "http:"
    && url.port !== ""
    && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname.toLowerCase());
  return loopback || origin === APPROVED_STAGING_ORIGIN;
}

/** Pure boundary used by the creator and its contract test. */
export function assertBoundTestUserTarget(
  client: SupabaseClient,
  target: Pick<E2ETarget, "apiUrl">,
): void {
  const runtimeUrl = (client as unknown as { supabaseUrl?: unknown }).supabaseUrl;
  const clientOrigin = exactOrigin(runtimeUrl, "the Supabase test client");
  const targetOrigin = exactOrigin(target.apiUrl, "the selected E2E target");
  if (!isApprovedTestOrigin(targetOrigin)) {
    throw new E2ETargetError("Auth test accounts may be created only on loopback or the approved staging project");
  }
  if (clientOrigin !== targetOrigin) {
    throw new E2ETargetError("the Supabase test client is not bound to the selected E2E target");
  }
}

/**
 * Creates an Auth test account only after proving that the service-role client
 * is connected to the explicitly selected E2E target. The check uses the
 * client's runtime URL, not caller-supplied credentials, and error messages do
 * not include either URL or any key material.
 */
export async function createBoundTestUser(
  client: SupabaseClient,
  target: Pick<E2ETarget, "apiUrl">,
  attributes: CreateUserAttributes,
) {
  assertBoundTestUserTarget(client, target);
  return client.auth.admin.createUser(attributes);
}
