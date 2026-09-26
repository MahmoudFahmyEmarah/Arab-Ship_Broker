import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const action = readFileSync(
  resolve(root, "app/(dashboard)/dashboard/account/actions.ts"),
  "utf8",
);
const migration = readFileSync(
  resolve(
    root,
    "supabase/migrations/20260923310000_account_anonymisation.sql",
  ),
  "utf8",
);

assert.match(action, /rpc\("fn_anonymize_account"/);
assert.match(action, /deleteUser\(\s*user\.id,\s*true\s*,?[\s\S]*?\)/);
assert.doesNotMatch(action, /from\("users"\)\.delete\(/);

assert.match(migration, /security definer/i);
assert.match(migration, /revoke all on function public\.fn_anonymize_account\(uuid\)[\s\S]*authenticated/i);
assert.match(migration, /grant execute on function public\.fn_anonymize_account\(uuid\)[\s\S]*service_role/i);
assert.match(migration, /supabase_user_id = null/i);
assert.match(migration, /erased_at = now\(\)/i);
assert.match(migration, /update public\.organization_members/i);
assert.match(migration, /delete from public\.vessel_claims/i);
assert.match(migration, /update public\.billing_customers/i);
assert.match(migration, /update public\.subscriptions/i);

console.log("account-erasure-check: PASS");
