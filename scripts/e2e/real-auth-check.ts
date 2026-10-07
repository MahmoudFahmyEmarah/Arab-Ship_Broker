// Real Auth through the LOCAL stack (C2O-078 P1 #5): create + sign-in + teardown + session/refresh-token invalidation,
// a seed that fails part-way, and the neutralisation fallback. Creates e2e accounts on the local stack and removes
// them. Refuses any hosted target. Run: npx tsx scripts/e2e/real-auth-check.ts
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { dbQuery, dbTx, resolveTarget } from "../../e2e/e2e-db";
import { noneCreated, teardownRows, undoPartialSeed, type RecoveryClient } from "../../e2e/e2e-cleanup";
import { PASSWORD, cleanupAdmin, seedAdmin, seedOrgSeat, type FixtureSeed } from "../../e2e/fixture-room.helpers";

let n = 0;
const ok = (c: boolean, m: string) => { assert.ok(c, m); n++; console.log(`  ok   ${m}`); };
if (resolveTarget().kind !== "local") throw new Error("real-auth-check runs on the local stack only");
const env = execSync("npx supabase status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const url = env.match(/^API_URL="?([^"\n]+)"?/m)![1];
const anonKey = env.match(/^ANON_KEY="?([^"\n]+)"?/m)![1];
const serviceKey = env.match(/^SERVICE_ROLE_KEY="?([^"\n]+)"?/m)![1];
const anon = () => createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const accountsBy = (email: string) => dbQuery(`select id from auth.users where email = '${email}';`).length;

(async () => {
  const stamp = `rauth${Date.now().toString(36)}`;
  // 1 · seed → sign in → teardown: the account, its session and its refresh token are gone
  const a = await seedAdmin(stamp);
  const c = anon();
  const s = await c.auth.signInWithPassword({ email: a.email, password: PASSWORD });
  ok(!s.error && !!s.data.session?.refresh_token, "a seeded admin signs in through real Auth and holds a refresh token");
  const refreshToken = s.data.session!.refresh_token;
  cleanupAdmin(a);
  ok(accountsBy(a.email) === 0, "the teardown removed the Auth account (exact id, one transaction)");
  const r = await anon().auth.refreshSession({ refresh_token: refreshToken });
  ok(!!r.error && !r.data.session, `the old refresh token no longer yields a session (${r.error?.message})`);
  const again = await anon().auth.signInWithPassword({ email: a.email, password: PASSWORD });
  ok(!!again.error, "the removed account cannot sign in");
  let second = "";
  try { cleanupAdmin(a); } catch (e) { second = (e as Error).message; }
  ok(/E2E_TARGET: 0 of 1 named rows/.test(second), "a second teardown of the same account is refused, never a silent zero-row success");

  // 2 · a seed that fails part-way undoes itself: the seat's organisation does not exist, the membership insert fails
  const ghostSeed = { stamp: `${stamp}x`, charterer: { orgId: randomUUID() } } as unknown as FixtureSeed;
  let msg = "";
  try { await seedOrgSeat(ghostSeed); } catch (e) { msg = (e as Error).message; }
  ok(/seat membership/.test(msg) && /the partial seed was removed \(1 account/.test(msg), `a failed seed reports and removes what it created (${msg.slice(0, 90)}…)`);
  ok(accountsBy(`e2e-fx-seat-${stamp}x@arabshipbroker.test`) === 0, "no account is left under the failed seed's email");

  // 3 · the fallback on real Auth: the undo transaction fails, so the account is banned and its sessions revoked
  const email = `e2e-fx-fb-${stamp}@arabshipbroker.test`;
  const id = randomUUID();
  const made = await admin.auth.admin.createUser({ id, email, password: PASSWORD, email_confirm: true });
  ok(!made.error, "a real account for the fallback case");
  const fs = await anon().auth.signInWithPassword({ email, password: PASSWORD });
  const fbToken = fs.data.session!.refresh_token;
  const created = noneCreated(); created.userIds.push(id); created.emails.push(email);
  let fb = "";
  try {
    await undoPartialSeed(admin as unknown as RecoveryClient, created, new Error("seed failed: injected"), {
      tx: (label, sql) => { if (label === "e2e partial-seed undo") throw new Error("injected undo failure"); dbTx(label, sql); },
      query: dbQuery,
    });
  } catch (e) { fb = (e as Error).message; }
  ok(new RegExp(`neutralised: \\[${id} \\(banned\\)\\]; UNRESOLVED: \\[\\]`).test(fb), "the fallback bans the account and verifies the ban by re-reading it");
  const fr = await anon().auth.refreshSession({ refresh_token: fbToken });
  ok(!!fr.error, `the neutralised account's refresh token is refused (${fr.error?.message})`);
  const fsi = await anon().auth.signInWithPassword({ email, password: PASSWORD });
  ok(!!fsi.error, "the neutralised account cannot sign in (banned, password randomised)");
  teardownRows("real-auth-check teardown", { userIds: [id] });
  ok(accountsBy(email) === 0, "the neutralised account is then removed");
  console.log(`E2E REAL AUTH CHECK: ${n} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
