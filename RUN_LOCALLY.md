# Arab ShipBroker — run locally

A Next.js 16 / React 19 / Tailwind v4 app backed by Supabase.

## Prerequisites
- **Node.js 20+** and npm
- A **Supabase** project (free tier is fine)

## 1. Install
```bash
npm install
```

## 2. Configure environment
```bash
cp .env.local.example .env.local
```
Fill in `.env.local` from your Supabase project (Settings → API):
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`  ← server-only (signup, account deletion, cron)

(Optional: `ANTHROPIC_API_KEY` + `NEXT_PUBLIC_ASSISTANT_ENABLED=true` for the AI parser; `CRON_SECRET` for the cron.)

## 3. Set up the database
In the Supabase **SQL editor**, run, in order:
1. Every file in `supabase/migrations/` **in filename order** (oldest → newest). These create the schema, RLS, the contact firewall, RPCs, etc.
2. Then `supabase/seed/unified_dataset.sql` — loads the real dataset (276 ports, 88 vessels, 27 open positions, 719 cargo). *(The `…000960_zone_enum_additions` migration must already be applied — it is, if you ran all migrations in order.)*

> Tip: a Supabase **Site URL** under Auth → URL Configuration set to `http://localhost:3000` makes email verification / password-reset links work in local dev.

## 4. Run
```bash
npm run dev
```
Open http://localhost:3000

- Public site: `/`, `/services`, `/market-insights`, `/contact`
- Sign up at `/auth/signup` → verify email (OTP) → `/dashboard`
- Admin tools live under `/admin/*` (requires an admin-role account)

## Useful scripts
```bash
npm run build      # production build
npm run lint       # eslint
npm start          # run the production build
```

## Notes
- `node_modules/`, `.next/`, and `.git/` are not in this archive — `npm install` and `npm run dev`/`build` regenerate them.
- Secrets are never committed; they live only in your `.env.local` (and in Vercel for deploys).
- Contact PII (counterparty owner/manager/email/phone) is firewalled at the DB layer — see `supabase/tests/firewall/` for the proof harness.
