# Billing & Gateway Layer

Design memo (6 Sep 2026): https://claude.ai/code/artifact/e883a5e1-5e24-4e9f-b110-e12510b74b6a

## Decisions (owner, 6 Sep 2026)
- Issuer: the Egyptian company. List prices in USD; every invoice carries the EGP equivalent at the CBE rate of the issue day (frozen on the invoice). Egyptian customers may be invoiced in EGP.
- Plans are per seat and bought by a company (the company admin assigns seats under My Company); personal one-seat subscriptions are allowed.
- Payments: bank transfer with the invoice number as reference (member reports, admin confirms), Paymob hosted checkout (Phase 2), owner manual activation with a written reason.
- VAT treatment per customer: standard 14 %, zero-rated export, out of scope, or *pending review* until the accountant confirms.
- Periods: monthly and annual (10 months' price); 7-day grace; reminders at −7 and −1 days (cron in Phase 2).
- Roles: owner issues, voids, credits, refunds and edits settings; the `billing` sub-admin preset views and records bank transfers.
- Documents are bilingual (English / Arabic); print → PDF for now.

## Phase 1 (shipped)
- Schema `20260905224816_billing_layer`: settings + Vault secrets, fx_rates, plans/prices, billing_customers, subscriptions, invoices/invoice_lines (immutable once issued, gapless numbering, DB-side totals), payments (DB-side settlement), webhook inbox, einvoice_submissions, append-only audit, `fn_billing_sync_tiers`, member RLS.
- Seats `20260905230744_billing_seats`: `organization_members.plan_seat`, `fn_org_set_plan_seat`, seat summary.
- Admin → Billing console (overview, invoices with drawer, customers, subscriptions, settings). ETA console lists the ledger's e-invoice states.
- Member → Subscription & Billing: live plan, profiles, invoices, self-serve subscribe (company seats or personal), pay-by-transfer instructions and "I have transferred".
- `lib/billing/eta.ts`: the ETA document JSON generated from the same rows (portal mode today, API later).

## Phase 2 — Paymob + lifecycle (shipped 6 Sep 2026)
- `lib/billing/paymob.ts`: auth → order → payment key → hosted iframe URL; USD invoices are charged in EGP at the invoice's frozen rate; `billing_payment_intents` maps the Paymob order to the invoice.
- `/api/billing/paymob/webhook` (POST, HMAC-SHA512 verified, `billing_webhook_inbox` idempotent on the transaction id) settles the invoice; `/api/billing/paymob/return` (GET, HMAC verified) settles idempotently and redirects to the billing tab with `?pay=success|pending|failed`.
- Paymob dashboard: set *Transaction processed callback* = `https://www.arabshipbroker.com/api/billing/paymob/webhook`, *Transaction response callback* = `https://www.arabshipbroker.com/api/billing/paymob/return`; store API key + HMAC in Billing → Settings (Vault), enter integration id + iframe id, tick "Show Pay by card".
- `/api/cron/billing` (daily 06:30 UTC): renewal invoices `renew_before_days` ahead (issued + emailed), reminders at −7 / −1 / overdue (once each, `billing_reminders`), past-due and expiry after the grace period (seats → T1), tier sync; logged to `job_runs`.
- Emails go through the Group Mail SMTP account (`lib/billing/mail.ts`): issued, due-7, due-1, overdue, expired.
- Billing → Settings gained the plan catalogue editor (names, EGS/GPC codes, USD prices) and the renew-before setting.
- Not built: saved-card auto-charge (renewals are invoiced and paid by link or transfer), Paymob refunds via API (owner records a credit note today).

## Phase 3 — ETA API
Signing service beside the e-seal token, submit / poll, UUID + long id stored, rejections surface as dashboard tasks; credit notes reference the UUID.

## Before the first paid invoice
Accountant confirms entity and VAT treatments; ETA portal registration and e-seal order; EGS codes registered and entered on the plans; Billing → Settings issuer and bank details filled.
