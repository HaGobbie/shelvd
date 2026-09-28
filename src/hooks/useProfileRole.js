// src/hooks/useProfileRole.js
// Reads the signed-in user's role from public.profiles (allowed by the
// existing "profiles: user can read own profile" policy).
import { useState, useEffect } from "react";
import { supabase } from "../config/supabaseClient";

export function useProfileRole(userId) {
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(Boolean(userId));

  useEffect(() => {
    if (!userId) { setRole(null); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) { setRole(data?.role ?? null); setLoading(false); }
      });
    return () => { cancelled = true; };
  }, [userId]);

  return { role, isSuperAdmin: role === "super_admin", loading };
}
