# Arab ShipBroker Platform

Professional dry bulk and break bulk shipbroking platform.
Sub-15K DWT handysize and coaster tonnage. Arabian Gulf, Red Sea, East Med, Black Sea.

## Setup — first time

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
```

Edit `.env` and set:
```
VITE_SUPABASE_URL=https://sidcsytgqalqacsgyguz.supabase.co
VITE_SUPABASE_ANON_KEY=<your anon key starting with eyJ...>
SUPABASE_SERVICE_KEY=<service_role key — for data migration only, NEVER ship to frontend>
```

Get keys from: Supabase → Project Settings → API → Project API keys

### 3. Run database migrations
Open Supabase → SQL Editor and paste/run:
1. The base schema (`arabshipbroker_schema.sql` from project root if present)
2. `supabase/migrations/001_schema_addendum.sql`

### 4. Load real data
Place your CargoMap Excel in the project root, then run:
```bash
npm run migrate ./ArabShipBroker_CargoMap_v3.xlsx
```

This loads:
- Ports (with locode, zone, country)
- 698 cargo records (with multi-port, WOG, circulation, laytime qualifier detection)
- 43 vessels with availability records

### 5. Start the dev server
```bash
npm run dev
```

Opens at http://localhost:3000

## Architecture

```
src/
  components/
    cargo/      CargoCard, PostCargoForm
    vessel/     VesselCard
    map/        LeafletMap, MapRightBar
    shared/     Sidebar, BunkerTicker, Announcements, LaycanPicker
  pages/        Dashboard, CargoMarket, TonnageMarket
  hooks/        useAuth, useCargo, useVessels
  lib/          supabase, cargo, map
  types/        index.ts (all entity types)
supabase/
  migrations/   SQL migrations
scripts/
  migrate-data.ts  Excel → Supabase loader
```

## Tier model

| Tier | Name | Description |
|---|---|---|
| T1 | Free | Vetted, zone-level match counts only |
| T2 | Promoted | Full match intel, partner names locked |
| T3 | Subscriber | Full access + Voyage Estimator |
| T4 | Partner | ASB-promoted key account |

## Notes

- Trust tier (NEW/VERIFIED/FLAGGED) is admin-only — never shown to users
- Subscription tier (T1-T4) drives feature access
- Contact data (email, phone, address) is encrypted end-to-end and only visible to ASB until a match is made
