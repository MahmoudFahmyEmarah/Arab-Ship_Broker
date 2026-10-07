// Partial-seed recovery (C2O-078 P1 #3): lost responses are reconciled, every response is checked, every account is
// re-read, and the error never claims more than was verified. Fakes stand in for Auth and the database.
// Run: npx tsx scripts/e2e/recovery-check.ts
import assert from "node:assert/strict";
import { noneCreated, undoPartialSeed, type RecoveryClient, type RecoveryDeps } from "../../e2e/e2e-cleanup";

let n = 0;
const ok = (c: boolean, m: string) => { assert.ok(c, m); n++; console.log(`  ok   ${m}`); };
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

function fakeAdmin(opts: { banFailures?: number; banAlwaysFails?: boolean; gone?: string[]; deactivateFails?: boolean }) {
  const banned = new Set<string>();
  let failures = opts.banFailures ?? 0;
  const calls: string[] = [];
  const admin: RecoveryClient = {
    auth: { admin: {
      async updateUserById(id) {
        calls.push(`ban ${id}`);
        if (opts.banAlwaysFails || failures-- > 0) return { error: { message: "gateway timeout" } };
        banned.add(id); return { error: null };
      },
      async getUserById(id) {
        if (opts.gone?.includes(id)) return { data: { user: null }, error: { message: "User not found", status: 404 } };
        return { data: { user: { banned_until: banned.has(id) ? new Date(Date.now() + 1e10).toISOString() : null } }, error: null };
      },
    } },
    from: () => ({ update: () => ({ eq: async () => ({ error: opts.deactivateFails ? { message: "denied" } : null }) }) }),
  };
  return { admin, calls };
}
const deps = (o: { txFails?: boolean; queryRows?: string[]; queryFails?: boolean }): RecoveryDeps & { sql: string[] } => {
  const sql: string[] = [];
  return {
    sql,
    tx: (label, s) => { sql.push(`${label}: ${s.slice(0, 40)}`); if (o.txFails && label === "e2e partial-seed undo") throw new Error("undo: rolled back (psql exit 3) — boom"); },
    query: (s) => { sql.push(`query: ${s.slice(0, 40)}`); if (o.queryFails) throw new Error("e2e query failed — refused"); return o.queryRows ?? []; },
  };
};
const run = async (created: ReturnType<typeof noneCreated>, admin: RecoveryClient, d: RecoveryDeps) => {
  try { await undoPartialSeed(admin, created, new Error("seed failed: org"), d); return "no error"; } catch (e) { return (e as Error).message; }
};

(async () => {
  // 1 · a lost createUser response: the account exists under the intended email; reconciled and removed
  {
    const c = noneCreated(); c.emails.push("e2e-fx-ch-a@arabshipbroker.test");
    const d = deps({ queryRows: [`${A}|e2e-fx-ch-a@arabshipbroker.test`] });
    const m = await run(c, fakeAdmin({}).admin, d);
    ok(c.userIds.includes(A) && /the partial seed was removed \(1 account/.test(m) && /reconciled/.test(m), "a lost response is reconciled by email, and the account is removed with the rest");
  }
  // 2 · undo fails; the ban fails twice then succeeds; the re-read shows the ban
  {
    const c = noneCreated(); c.userIds.push(A);
    const f = fakeAdmin({ banFailures: 2 });
    const m = await run(c, f.admin, deps({ txFails: true }));
    ok(f.calls.filter((x) => x === `ban ${A}`).length === 3 && new RegExp(`neutralised: \\[${A} \\(banned\\)\\]; UNRESOLVED: \\[\\]`).test(m) && /could NOT be removed/.test(m), "a failed undo retries the ban, re-reads the account and reports it neutralised, never removed");
  }
  // 3 · undo fails and the ban never succeeds: the account is UNRESOLVED, by id
  {
    const c = noneCreated(); c.userIds.push(A, B);
    const m = await run(c, fakeAdmin({ banAlwaysFails: true, gone: [B] }).admin, deps({ txFails: true }));
    ok(new RegExp(`UNRESOLVED: \\[${A} \\(ban not verified\\)\\]`).test(m) && new RegExp(`${B} \\(removed\\)`).test(m) && !/the partial seed was removed/.test(m), "an account that could not be banned is reported UNRESOLVED; one already gone is reported removed");
  }
  // 4 · the ban works but the public row could not be deactivated: the account is UNRESOLVED (C2O-084 P1)
  {
    const c = noneCreated(); c.userIds.push(A);
    const m = await run(c, fakeAdmin({ deactivateFails: true }).admin, deps({ txFails: true }));
    ok(new RegExp(`UNRESOLVED: \\[${A} \\(public row not deactivated\\)\\]`).test(m) && /neutralised: \[\]/.test(m), "a failed deactivation leaves the account UNRESOLVED, never neutralised");
  }
  // 4b · the ban works but sessions could not be revoked: UNRESOLVED (an access or refresh token may still work)
  {
    const c = noneCreated(); c.userIds.push(A);
    const d = deps({ txFails: true });
    const real = d.tx;
    d.tx = (label, s) => { if (label === "e2e session revocation") throw new Error("revocation refused"); real(label, s); };
    const m = await run(c, fakeAdmin({}).admin, d);
    ok(new RegExp(`UNRESOLVED: \\[${A} \\(sessions not revoked\\)\\]`).test(m) && /neutralised: \[\]/.test(m), "a failed session revocation leaves the account UNRESOLVED, never neutralised");
  }
  // 5 · reconciliation impossible: even a successful row removal is not reported as success
  {
    const c = noneCreated(); c.emails.push("e2e-fx-ow-b@arabshipbroker.test");
    const m = await run(c, fakeAdmin({}).admin, deps({ queryFails: true }));
    ok(/an intended account could not be reconciled/.test(m) && /UNRESOLVED: \[email e2e-fx-ow-b@arabshipbroker\.test\]/.test(m), "an intended email that could not be looked up stays UNRESOLVED; the undo never claims success");
  }
  // 6 · sessions and refresh tokens are revoked on the fallback path
  {
    const c = noneCreated(); c.userIds.push(A);
    const d = deps({ txFails: true });
    await run(c, fakeAdmin({}).admin, d);
    ok(d.sql.some((s) => s.startsWith("e2e session revocation")), "the fallback revokes the accounts' sessions and refresh tokens");
  }
  // 7 · the original failure is always carried
  {
    const c = noneCreated();
    const m = await run(c, fakeAdmin({}).admin, deps({}));
    ok(m.startsWith("seed failed: org — "), "the seed's own error leads every message");
  }
  console.log(`E2E RECOVERY CHECK: ${n} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
