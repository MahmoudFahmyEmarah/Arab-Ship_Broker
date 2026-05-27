# Arab ShipBroker — Setup Guide

For Capt Mohamed Dawoud. Step by step, no developer required.

---

## STEP 1 — Clone the repo

Open a terminal on your computer and run:

```bash
git clone https://github.com/CptDawoud/Arabshipbroker.git
cd Arabshipbroker
git checkout build-v2
```

---

## STEP 2 — Install Node.js (if you don't have it)

Download and install: https://nodejs.org (LTS version)

Verify it works:
```bash
node --version    # should show v20.x or higher
npm --version
```

---

## STEP 3 — Install project dependencies

In the project folder:
```bash
npm install
```

This downloads everything the project needs. Takes 1–2 minutes.

---

## STEP 4 — Run database migrations in Supabase

1. Open https://supabase.com/dashboard and select project `sidcsytgqalqacsgyguz`
2. Click **SQL Editor** in the left sidebar
3. Run these files **in order** — paste each into the editor and click Run:

   a. `supabase/migrations/000_base_schema.sql` — the original schema (skip if already run)

   b. `supabase/migrations/001_schema_addendum.sql` — new columns and tables

   c. `supabase/migrations/002_seed_demo_data.sql` — demo announcements, bunker prices, commodities

Each file is in the project folder.

---

## STEP 5 — Configure your environment file

In the project folder, copy the template:

```bash
cp .env.example .env
```

Open `.env` in any text editor (Notepad, TextEdit, VS Code...) and replace `your_anon_key_here` with your real anon key:

```
VITE_SUPABASE_URL=https://sidcsytgqalqacsgyguz.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOi...
```

Save the file.

---

## STEP 6 — Load your real data (Cargo + Vessels)

This runs the script that reads your Excel and loads everything into Supabase.

**First**, you also need the `service_role` key for bulk insert. Get it from:
Supabase → Settings → API → `service_role` (click "Reveal")

Add it to `.env`:
```
SUPABASE_SERVICE_KEY=eyJhbGc...  (the service_role one)
```

⚠️ This key has full database access. Never commit `.env` to git (it's already in .gitignore).

**Place your Excel** in the project root, then run:

```bash
npm run migrate ./ArabShipBroker_CargoMap_v3_27May2026.xlsx
```

You'll see:
```
Loading workbook from: ./ArabShipBroker_CargoMap_v3_27May2026.xlsx
Sheets: CARGO_LOG, VESSEL_LOG, PORT_CODES...

=== Step 1: Ports ===
PORTS: 120 records upserted

=== Step 2: Cargo ===
CARGO: 698 inserted, 0 skipped

=== Step 3: Vessels ===
VESSELS: 43 inserted, 0 skipped

✓ Migration complete
```

---

## STEP 7 — Start the platform

```bash
npm run dev
```

Browser opens automatically at http://localhost:3000

You'll see the login page. **You need to create an admin user first:**

In Supabase → Authentication → Users → Add user (email + password)

Then in SQL Editor:
```sql
UPDATE auth.users
SET raw_app_meta_data = jsonb_set(raw_app_meta_data, '{role}', '"admin"')
WHERE email = 'your-email@example.com';
```

Now sign in with that email/password.

---

## STEP 8 — Set your subscription tier (for demo)

To switch tiers and test feature gating, in SQL Editor:

```sql
UPDATE users SET subscription_tier = 'T3'  -- or T1, T2, T4
WHERE email = 'your-email@example.com';
```

T1 = Free, T2 = Promoted, T3 = Subscriber, T4 = Partner

Voyage Estimator unlocks at T3+.

---

## TROUBLESHOOTING

**"Host not in allowlist"** — Go to Supabase → Settings → API → Network Restrictions and disable, or add your IP.

**Migration fails on "column does not exist"** — You skipped Step 4. Run the SQL migrations.

**"Missing Supabase environment variables"** — Your `.env` file is empty or wrong path. Check Step 5.

**Login fails** — Did you create a user in Supabase auth (Step 7)?

---

## WHAT THE PLATFORM DOES

- **Dashboard** — Cargo + vessel panels side by side, with stat filters
- **Cargo Market** — Map (left) + cargo cards (right), 50/50 split
- **Tonnage Market** — Same layout, for vessels
- **Voyage Estimator** — Full P&L tool (T3+ only)
- **Post Cargo** — 5-step form to submit a new cargo
- **Admin Panel** — Manage announcements, fuel prices, review queue

Everything is encrypted end-to-end. Contact details (phone, email, addresses) are visible only to Arab ShipBroker until your listing is matched.
