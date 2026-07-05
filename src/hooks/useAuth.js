// src/hooks/useAuth.js
// Wraps Supabase Auth's session listener — the direct replacement for
// Firebase's onAuthStateChanged(auth, callback). Kept separate from
// useStores.js since auth is a different concern from data fetching.

import { useState, useEffect } from "react";
import { supabase } from "../config/supabaseClient";

/**
 * useAuth
 * @returns {{ user: import("@supabase/supabase-js").User|null, loading: boolean }}
 */
export function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Get the current session once on mount (handles page reloads —
    // persistSession: true in supabaseClient.js keeps this in localStorage)
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Subscribe to future auth changes (sign-in, sign-out, token refresh,
    // and the redirect back from Google OAuth)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return { user, loading };
}
