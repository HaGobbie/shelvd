// src/config/supabaseClient.js
//
// Replaces src/firebase/config.js
//
// Env vars come from a .env file (git-ignored) locally, and from
// GitHub Actions "secrets" during the build (see .github/workflows/deploy.yml).
// Vite only exposes vars prefixed with VITE_ to client-side code.

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. " +
      "Add them to a .env file locally, and as repo secrets for GitHub Actions."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Persist the owner/barangay-official session in localStorage so
    // they stay logged in across page reloads on GitHub Pages.
    persistSession: true,
    autoRefreshToken: true,
  },
  realtime: {
    // Throttle inbound events per second per channel — a small safety
    // net against runaway egress if a store's inventory updates rapidly.
    params: { eventsPerSecond: 5 },
  },
});
