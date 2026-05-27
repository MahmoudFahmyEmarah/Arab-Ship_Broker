# Arab ShipBroker Platform

Professional dry bulk and break bulk shipbroking platform.

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
```

Open `.env` and set:
- `VITE_SUPABASE_URL` — your Supabase project URL
- `VITE_SUPABASE_ANON_KEY` — your Supabase anon key (starts with `eyJ...`)

### 3. Run database migrations
In Supabase SQL editor, run in order:
1. `supabase/migrations/001_schema_addendum.sql` — new columns and tables

### 4. Start development server
```bash
npm run dev
```

Platform opens at http://localhost:3000

## Project structure

```
src/
  components/
    cargo/      — CargoCard, CargoList, PostCargoForm
    vessel/     — VesselCard, VesselList, PostPositionForm
    map/        — MapContainer, CargoMarker, VesselMarker
    shared/     — BunkerTicker, Sidebar, Announcements
    admin/      — AdminPanel, ReviewQueue, UserManagement
  pages/        — Dashboard, CargoMarket, TonnageMarket, VoyageEstimator
  hooks/        — useCargo, useVessels, useAuth, useTier
  lib/          — supabase.ts, cargo.ts, vessel.ts, map.ts
  types/        — index.ts
supabase/
  migrations/   — SQL migration files
```

## Supabase anon key location
Project Settings → API → Project API keys → `anon public`
