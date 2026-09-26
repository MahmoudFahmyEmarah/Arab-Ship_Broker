import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260923330000_user_privilege_boundary.sql"),
  "utf8",
);
const gate = readFileSync(resolve(process.cwd(), "lib/admin/require-admin.ts"), "utf8");
const reviewActions = readFileSync(resolve(process.cwd(), "app/(admin)/admin/queue/actions.ts"), "utf8");
const smoke = readFileSync(
  resolve(process.cwd(), "supabase/tests/integration/user_privilege_boundary_smoke.sql"),
  "utf8",
);

assert.match(migration, /drop policy if exists "users: own row"/i);
assert.match(migration, /for update to authenticated[\s\S]*with check/i);
assert.match(migration, /revoke all on table public\.users from anon, authenticated/i);
assert.match(migration, /grant select, update on table public\.users to authenticated/i);
assert.match(migration, /fn_guard_user_profile_update/i);
assert.match(smoke, /subscription_tier/i);
assert.match(smoke, /admin_tier/i);
assert.match(smoke, /admin_perms/i);
assert.match(smoke, /trust_tier/i);
assert.match(migration, /raw_app_meta_data/i);
assert.match(migration, /fn_is_admin/i);
assert.match(gate, /user\.app_metadata\?\.role !== "admin"/);
assert.match(reviewActions, /async function executeReviewAction[\s\S]*?const supabase = getSupabaseAdminClient\(\)/);

console.log("user-privilege-boundary-check: PASS");
