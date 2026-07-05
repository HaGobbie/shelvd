# Firebase/Render → Supabase/GitHub Pages Migration

## What's in this folder

```
sql/
  01_schema_and_postgis.sql       Tables, PostGIS, indexes
  02_functions_and_triggers.sql  Auto-timestamps, nearby_stores(), search_inventory()
  03_row_level_security.sql      RLS policies
src/
  supabase/supabaseClient.js     Drop-in replacement for src/firebase/config.js
  hooks/useStores.js             Drop-in replacement for src/hooks/useStores.js
.github/workflows/deploy.yml     GitHub Actions CI/CD to GitHub Pages
vite.config.js                  Updated with `base` for GitHub Pages
.env.example                    Copy to .env, fill in your Supabase keys
```

## Setup steps

1. **Supabase project**: create one at supabase.com (free tier).
2. **Run the SQL**: paste `01_`, `02_`, `03_` (in that order) into
   Supabase Dashboard → SQL Editor → New Query → Run.
3. **Swap dependencies**:
   ```bash
   npm uninstall firebase
   npm install @supabase/supabase-js
   ```
4. **Copy files** into your project at the paths shown above
   (delete `src/firebase/` entirely).
5. **Env vars**: copy `.env.example` → `.env`, fill in your project's
   URL + anon key from Supabase Dashboard → Project Settings → API.
   Add `.env` to `.gitignore` if it isn't already.
6. **GitHub repo secrets**: Settings → Secrets and variables → Actions →
   New repository secret. Add `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` with the same values.
7. **GitHub Pages source**: Settings → Pages → Build and deployment →
   Source: **GitHub Actions** (not "Deploy from a branch").
8. **Edit `vite.config.js`**: set `REPO_NAME` to your actual repo name.
9. **Push to `main`** — the workflow builds and deploys automatically.

## Why these specific choices (bandwidth on the free tier)

- **`select('id, name, latitude, longitude')` for the map, never `select('*')`.**
  Map markers don't need `owner_email`, `contact_number`, `address`, etc.
  Full store details + inventory load only when a resident taps a pin
  (`useStoreDetails`), not for all stores on page load.
- **`nearby_stores()` and `search_inventory()` run in Postgres**, not in the
  browser. Your old code pulled every store's inventory to the client and
  sorted/filtered with JS; that's the single biggest egress cost. Filtering
  server-side means only matching rows cross the wire.
- **Realtime channels are scoped and filtered.** `useMapMarkers` only
  listens to the `stores` table (pin position/status changes); it does
  *not* re-fetch on every inventory update. `useStoreDetails` /
  `useOwnerInventory` filter their channel to one `store_id`, so an
  update to Store A never pushes bytes to a resident viewing Store B's
  detail sheet.
- **Every hook cleans up its channel in the `useEffect` return function**
  (`supabase.removeChannel(channel)`), so navigating around the app
  doesn't accumulate open WebSocket subscriptions that keep counting
  against your realtime connection limits.
- **PostGIS `geography(Point, 4326)` + a GIST index** makes `ST_DWithin`
  proximity queries index-backed instead of a full-table scan — this
  matters once you have more than a handful of stores.

## Not covered here (do these yourself, based on your actual choices)

- Auth UI wiring for `signInWithPassword` / Google OAuth via Supabase Auth
  (conceptually a 1:1 swap for your `signInWithEmailAndPassword` /
  `signInWithPopup` calls — see Supabase Auth docs for the exact calls).
- Migrating existing Firestore data into these tables (a one-time script
  reading Firestore and calling `supabase.from(...).insert(...)`).
- CSV/Excel bulk upload — same PapaParse/SheetJS approach, just insert into
  `inventory` with `supabase.from('inventory').insert([...])` (batched).
