/**
 * Create the three admin seats the browser suite needs, and sign each one in.
 *
 *   view  — may read the Data Quality console and change nothing
 *   run   — may start, recover, retry and requeue; may not change configuration
 *   edit  — may change rules, settings and channel modes
 *
 * They are created on the LOCAL Supabase stack only, and the script refuses to
 * run against anything else. Seeding three admins is exactly the operation you
 * never want pointed at production by accident, so the guard is not a courtesy
 * — it is the reason this file can exist at all.
 *
 * Each seat is signed in through the real login form rather than by forging a
 * cookie: a hand-built session proves the test harness can build a session, not
 * that the application accepts one.
 */
import { chromium, type FullConfig } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

const LOCAL_API = "http://127.0.0.1:54321";
const PASSWORD = "e2e-Test-Passw0rd!";

export const SEATS = [
  { key: "view", email: "e2e-view@arabshipbroker.test", access: "view" as const },
  { key: "run", email: "e2e-run@arabshipbroker.test", access: "run" as const },
  { key: "edit", email: "e2e-edit@arabshipbroker.test", access: "edit" as const },
];

export default async function globalSetup(config: FullConfig) {
  const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
  const apiUrl = process.env.E2E_SUPABASE_URL ?? LOCAL_API;
  const serviceKey = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY;

  // ── the guard ────────────────────────────────────────────────────────────
  if (!/127\.0\.0\.1|localhost/.test(apiUrl)) {
    throw new Error(
      `global-setup refuses to seed admin users against ${apiUrl}. ` +
        "This creates three administrator accounts; it runs against the local Supabase stack only.",
    );
  }
  if (!serviceKey) {
    throw new Error("E2E_SUPABASE_SERVICE_ROLE_KEY is not set — see e2e/README.md");
  }

  const sb = createClient(apiUrl, serviceKey, { auth: { persistSession: false } });

  for (const seat of SEATS) {
    // create, or reuse if a previous run left it behind
    const { data: created, error } = await sb.auth.admin.createUser({
      email: seat.email,
      password: PASSWORD,
      email_confirm: true,
    });
    let authId = created?.user?.id ?? null;
    if (error && !/already been registered|already exists/i.test(error.message)) {
      throw new Error(`creating ${seat.email}: ${error.message}`);
    }
    if (!authId) {
      const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 200 });
      authId = list?.users.find((u) => u.email === seat.email)?.id ?? null;
      if (!authId) throw new Error(`could not find or create ${seat.email}`);
      await sb.auth.admin.updateUserById(authId, { password: PASSWORD, email_confirm: true });
    }

    // The application row that carries the seat. `sub` tier plus one section
    // permission is exactly what a real sub-admin has.
    //
    // public.users has only a primary key on id — no unique constraint on
    // supabase_user_id or email — so this looks the row up and inserts or
    // updates explicitly rather than relying on ON CONFLICT.
    // public.users.id IS the auth user id (users_id_fkey references
    // auth.users(id) on delete cascade), so it is set explicitly rather than
    // left to a default.
    const seatRow = {
      id: authId,
      supabase_user_id: authId,
      email: seat.email,
      full_name: `E2E ${seat.key} seat`,
      role: "admin",
      is_active: true,
      admin_tier: "sub",
      admin_perms: { dataquality: seat.access, cargo: seat.access, ports: seat.access },
    };
    const { data: existing } = await sb.from("users").select("id").eq("id", authId).maybeSingle();
    const { error: upErr } = existing
      ? await sb.from("users").update(seatRow).eq("id", (existing as { id: string }).id)
      : await sb.from("users").insert(seatRow);
    if (upErr) throw new Error(`seating ${seat.email}: ${upErr.message}`);
  }

  // ── sign each one in through the real form ───────────────────────────────
  fs.mkdirSync(path.join(process.cwd(), "e2e", ".auth"), { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const seat of SEATS) {
      const ctx = await browser.newContext({ baseURL });
      const page = await ctx.newPage();
      await page.goto("/auth/login");
      await page.locator('input[name="email"]').fill(seat.email);
      await page.locator('input[name="password"]').fill(PASSWORD);
      await page.getByRole("button", { name: /sign in|log in/i }).first().click();
      // the admin console is the proof the session is real
      await page.waitForURL(/\/admin|\/dashboard/, { timeout: 30_000 });
      await ctx.storageState({ path: `e2e/.auth/${seat.key}.json` });
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  void config;
}
