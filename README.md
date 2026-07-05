# Firebase/Render → Supabase/GitHub Pages Migration

## Folder map

```
sql/
  01_schema_and_postgis.sql        Tables, PostGIS, indexes (pg_trgm fixed)
  02_functions_and_triggers.sql   Auto-timestamps, nearby_stores(), search_inventory()
  03_row_level_security.sql       RLS policies
  04_map_marker_worst_status.sql  worst_status column so the map never needs full inventory
src/
  config/supabaseClient.js        Drop-in replacement for src/firebase/config.js
  hooks/useAuth.js                Supabase session listener (was onAuthStateChanged)
  hooks/useStores.js              useMapMarkers, useStoreDetails, useMyStore,
                                   useOwnerInventory, searchInventory, nearbyStores,
                                   useDebouncedSearchMatches, formatLastUpdated,
                                   getWorstStatusForQuery
  App.jsx
  components/
    MapContainer.jsx
    StoreEditModal.jsx
    StoreRegistrationForm.jsx
    ProductFormModal.jsx
    ConfirmDeleteModal.jsx
  pages/
    OwnerDashboard.jsx
.github/workflows/deploy.yml       GitHub Actions CI/CD to GitHub Pages
vite.config.js                    `base` set for GitHub Pages
.env.example                      Copy to .env, fill in your Supabase keys
```

`StoreDetails.jsx`, `StoreMarker.jsx`, and `SearchBar.jsx` need **no changes** —
the hooks layer maps Supabase's snake_case rows into the same camelCase shapes
(`store.ownerName`, `store.coords`, `product.lastUpdated`, etc.) those
components already expected.

## Setup steps

1. Run `01_` → `02_` → `03_` → `04_` in that order in Supabase Dashboard → SQL Editor.
   (If you already ran an earlier version of `01_`, see the note at the bottom
   about cleanly re-running it.)
2. `npm uninstall firebase && npm install @supabase/supabase-js`
3. Copy every file above into your project at the matching path, replacing
   the old Firebase versions (delete `src/firebase/` entirely).
4. Copy `.env.example` → `.env`, fill in your Supabase URL + anon key.
5. Add the same two values as GitHub repo secrets (Settings → Secrets and
   variables → Actions) named `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
6. GitHub Pages → Settings → Pages → Source: **GitHub Actions**.
7. Set `REPO_NAME` in `vite.config.js` to your actual repo name.
8. **Supabase Auth → Providers → Google**: enable it and add your OAuth
   client ID/secret (from Google Cloud Console) if you want the "Continue
   with Google" button to work. Add your GitHub Pages URL to
   Authentication → URL Configuration → Redirect URLs.
9. Push to `main`.

## What changed in this round (App.jsx, modals, OwnerDashboard)

- **Data shapes stayed camelCase.** All Supabase reads/writes go through
  `useStores.js`, which maps `owner_name` ↔ `ownerName`, `last_updated` ↔
  `lastUpdated`, etc. This is why `StoreDetails.jsx` needed zero changes —
  it never touched Firebase directly in the first place.
- **PostGIS writes use EWKT text.** `stores.location` is a
  `geography(Point,4326)` column; `latitude`/`longitude` are *generated*
  (read-only) columns derived from it. So `StoreEditModal.jsx` and
  `StoreRegistrationForm.jsx` write location as
  `` `SRID=4326;POINT(${lng} ${lat})` `` — Postgres casts that string
  automatically. You cannot write `latitude`/`longitude` directly; Postgres
  will reject it since they're generated columns.
- **Map pin coloring moved server-side.** `MapContainer.jsx` no longer scans
  `store.inventory` (that array isn't fetched for the whole map anymore).
  Idle pins use `marker.worstStatus`, a column a Postgres trigger keeps in
  sync on every inventory change (`04_map_marker_worst_status.sql`).
  Search-active pins use `searchMatches`, built by the new
  `useDebouncedSearchMatches()` hook, which calls the `search_inventory()`
  RPC ~300ms after the user stops typing. **This means search now has a
  small network delay it didn't have before** — the necessary tradeoff for
  not preloading every store's inventory.
- **Auth is Supabase Auth**, not Firebase Auth:
  - `onAuthStateChanged` → the new `useAuth()` hook (`supabase.auth.onAuthStateChange`)
  - `signInWithEmailAndPassword` → `supabase.auth.signInWithPassword`
  - `signInWithPopup(GoogleAuthProvider)` → `supabase.auth.signInWithOAuth({ provider: 'google' })`,
    which is a full-page redirect, not a popup — so there's no
    `auth/popup-blocked` case to handle anymore, but you do need to
    configure the redirect URL in Supabase (step 8 above) and in your
    Google Cloud OAuth client.
  - `signOut(auth)` → `supabase.auth.signOut()`
  - `user.uid` → `user.id`, everything else (`user.email`) is unchanged.
- **New `useMyStore(userId)` hook** replaces the old inline
  `query(collection(db,"Stores"), where("ownerId","==", user.uid))` +
  `onSnapshot` in `OwnerDashboard.jsx`. It returns the owner's store
  *regardless of approval status* and updates live if a barangay official
  approves/rejects it while the owner has the tab open.
- **Added a pending/rejected gate in `OwnerDashboard.jsx`** that wasn't
  fully wired in the version you shared (the truncation cut off right
  before this). Since your schema already has a `status` column with an
  approval workflow, an owner whose store is `pending_approval` or
  `rejected` now sees a status screen instead of an empty inventory
  dashboard — check `myStore.rejectionReason` is a field you're populating
  from your approval panel if you want that message to show.

## Bandwidth reasoning carried over from the SQL/hooks delivery

- Map markers select 4-5 columns, never `select('*')`.
- Full store + inventory only loads when a pin is tapped
  (`useStoreDetails`) or in the owner's own dashboard (`useOwnerInventory`).
- Search filtering and distance sorting happen in Postgres
  (`search_inventory()`, `nearby_stores()`), not in the browser.
- Every realtime channel is scoped (`filter: store_id=eq.X` or
  `owner_id=eq.Y`) and cleaned up via `supabase.removeChannel()` in each
  hook's `useEffect` return.

## If you already ran an earlier, buggy `01_schema_and_postgis.sql`

If you hit the `gin_trgm_ops` error from before and are unsure what state
your DB is in, the cleanest fix is to reset and re-run everything in order:

```sql
drop schema public cascade;
create schema public;
grant all on schema public to postgres, anon, authenticated, service_role;
```

Then run `01_` → `02_` → `03_` → `04_` fresh.

## Still not covered (unchanged from before)

- Migrating existing Firestore data into these tables (one-time script).
- CSV/Excel bulk inventory upload.
- Barangay official approval panel UI (the RLS/status plumbing for it
  exists — `stores: officials can update any store` — but no component
  was in your original file set for it, so nothing to migrate yet).
