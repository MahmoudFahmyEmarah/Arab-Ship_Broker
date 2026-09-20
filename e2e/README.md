# Browser acceptance for the Data Quality console

**Status: written, never executed, and not yet runnable.** Three things are
missing, and the third is the one that matters:

1. No browser binary (`npx playwright install chromium`).
2. No seeded admin seats or run/notification states (below).
3. **The console exposes no `data-testid` attributes at all.** These specs
   select by them, so every one of them would fail on the first line — not
   because the behaviour is wrong but because the hooks are not there.

That third point is a real gap in this work, stated rather than glossed. The
specs describe the behaviour the brief asked to be covered, and they are
precise about what they expect; turning them into a passing suite needs the
attributes below added to the console first. That is a small, mechanical
change, but it touches rendering code and was not made blind — adding
selectors that nothing can run against would be unverified churn in UI
components on the eve of a release.

### The hooks the specs need

| attribute | where |
|---|---|
| `data-testid="health-tiles"` | the Overview tile strip |
| `data-testid="run-row-<id>"` | each row in Runs |
| `data-testid="run-detail"`, `run-error`, `run-coverage`, `run-rule-errors`, `run-progress` | the run detail panel |
| `data-testid="run-state-stalled"` | the state badge, when the run is stalled |
| `data-testid="issue-row-<id>"`, `issue-drawer` | Issues |
| `data-testid="notification-outbox"`, `notification-<idem_key>` | Settings → Notifications |
| `data-testid="permission-view-notice"` | the banner a view seat sees |
| `data-testid="rule-error"` | the rule editor's refusal message |
| `data-testid="gate-refusal"`, `gate-correlation-id`, `gate-log-rows` | the refusal toast and Gate → log |
| `data-testid="cargo-row-<id>"`, `port-row-<locode>` | Admin → Cargo and Admin → Ports |

Rows also need `tabindex="0"`, a `role`, and Enter/Space handlers for
`data-quality-a11y.spec.ts` to pass — and whether they have those today is
exactly what that spec exists to find out.

## Why it cannot honestly be run without seeding

Every permission assertion is about what a *real* seat can do. Signing in as
the owner and then asserting that a "view seat" cannot press Run proves
nothing — it would pass against a console with no permission checks at all.
The suite therefore needs three genuine admin seats, and refuses to run
without them.

## What to provide

1. Install the runner and one browser:

   ```
   npm install --save-dev @playwright/test
   npx playwright install chromium
   ```

2. Create three admin users on a **non-production** environment, each with a
   different Data Quality permission, and sign each one in once to capture its
   session:

   | seat  | permission on the `dataquality` section | expected to be able to |
   |-------|-----------------------------------------|------------------------|
   | view  | `view`                                  | read everything, change nothing |
   | run   | `run`                                   | start, recover, retry, requeue |
   | edit  | `edit`                                  | all of the above, plus rules, settings and channel modes |

   ```
   npx playwright open --save-storage=e2e/.auth/view.json $E2E_BASE_URL/auth/login
   npx playwright open --save-storage=e2e/.auth/run.json  $E2E_BASE_URL/auth/login
   npx playwright open --save-storage=e2e/.auth/edit.json $E2E_BASE_URL/auth/login
   ```

3. Seed the run and notification states the state tests read. They are states,
   not fixtures, and the console has no way to force them from the UI:

   ```sql
   -- a stalled run: running, no batch reported for longer than STALL_MS (90 s)
   insert into public.dq_runs (scope, mode, batch_size, status, started_at, last_batch_at, started_by_name)
   values ('{"kind":"db"}', 'rules', 1000, 'running', now() - interval '10 min', now() - interval '5 min', 'e2e');

   -- completed with errors, and failed
   insert into public.dq_runs (scope, mode, batch_size, status, rule_errors, started_by_name)
   values ('{"kind":"db"}', 'rules', 1000, 'completed_with_errors',
           '[{"rule":"E2E-01","table":"ports","error":"seeded"}]'::jsonb, 'e2e');
   insert into public.dq_runs (scope, mode, batch_size, status, error, started_by_name)
   values ('{"kind":"db"}', 'rules', 1000, 'failed', 'seeded for the browser suite', 'e2e');

   -- the four notification states: pending, retrying, failed, sent
   insert into public.dq_notification_outbox (idem_key, kind, payload, status, attempts, next_attempt_at)
   values ('e2e/pending',  'digest', '{}', 'queued', 0, now()),
          ('e2e/retrying', 'digest', '{}', 'queued', 3, now() + interval '20 min'),
          ('e2e/failed',   'digest', '{}', 'failed', 8, now()),
          ('e2e/sent',     'digest', '{}', 'sent',   1, now());
   ```

4. Run:

   ```
   E2E_BASE_URL=https://staging.example.com npx playwright test
   ```

## What is covered

| spec | what it asserts |
|------|-----------------|
| `data-quality-permissions.spec.ts` | a view seat cannot run, recover, edit, schedule or requeue; a run seat can run/recover/retry but cannot change configuration; an edit seat can change configuration |
| `data-quality-states.spec.ts` | stalled, completed-with-errors and failed runs each present their own state and the action that belongs to it; the four notification states read correctly |
| `data-quality-a11y.spec.ts` | issue rows and run rows take keyboard focus and activate with Enter and Space |
| `data-quality-enforcement.spec.ts` | a refused write shows the rule that refused it and a correlation id the gate log can be searched by |

## The trap these tests exist to avoid

A permission test that only checks a button is *hidden* passes against a
console that hides the button and still accepts the request. Each permission
spec therefore checks the control is absent **and** that the underlying server
action refuses — the second assertion is the one that matters.
