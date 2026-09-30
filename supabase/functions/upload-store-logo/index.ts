// supabase/functions/upload-store-logo/index.ts
//
// Stores a store's logo as a .webp file inside your GitHub repo
// (public/store-logos/<storeId>-<contenthash>.webp) and keeps stores.logo_url
// pointing at it. Replacing a logo commits the new file, updates the store,
// THEN deletes the old file — so a failure part-way never leaves a store
// without a logo.
//
// If uploads keep failing, send { action: "diagnose" } (no auth needed
// beyond being signed in) — see the "diagnose" branch below. The
// StoreLogoUploader UI has a "Check what's wrong" button that calls this.
//
// ─── ONE-TIME SETUP ───────────────────────────────────────────────────────
//  1. GitHub → Settings → Developer settings → Fine-grained personal access
//     tokens → Generate. Repository access: ONLY HaGobbie/shelvd.
//     Permissions → Repository permissions → Contents: Read and write.
//  2. supabase secrets set GITHUB_TOKEN=github_pat_xxx GITHUB_REPO=HaGobbie/shelvd GITHUB_BRANCH=main
//  3. supabase functions deploy upload-store-logo      (keep JWT verification ON)
//     Setting secrets does NOT restart already-deployed functions — you
//     must redeploy (or supabase functions deploy --no-verify-jwt=false
//     again) after step 2 for the new secrets to take effect.
//  4. Lock ALLOWED_ORIGIN below to your Pages URL (e.g. https://hagobbie.github.io).

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GH_TOKEN, GH_REPO, putFile, deleteFile, isWebp, shortHash, rawUrl, diagnose } from "../_shared/githubStorage.ts";

const ALLOWED_ORIGIN = "*";
const FOLDER = "public/store-logos";
const MAX_BYTES = 300 * 1024; // browser targets ≤ ~100 KB; this is the hard ceiling

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    // 1. Who is calling? (required even for "diagnose", so this can't be poked anonymously)
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);
    const uid = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const { action, storeId, image } = body as { action?: string; storeId?: string; image?: string };

    // Read-only self-check — see githubStorage.ts. Doesn't touch GitHub content, just credentials.
    // Read-only self-check (see githubStorage.ts for the GitHub half). This
    // ALSO checks the Supabase side now: diagnose() only ever talked to
    // GitHub, so it could — and did — come back all-green while the actual
    // upload still failed with "store_not_found". That happens when these
    // Edge Functions are deployed to a DIFFERENT Supabase project than the
    // one the website's database actually lives in (SUPABASE_URL/the
    // service-role key are injected per-project automatically, based on
    // whichever project "supabase functions deploy" was run against — a
    // separate thing from which project the SQL editor happened to be
    // pointed at, or which project the frontend's own .env uses).
    if (action === "diagnose") {
      const gh = await diagnose();
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "(not set)";
      const dbSteps: Array<{ step: string; ok: boolean; detail: string }> = [
        { step: "supabase_project", ok: true, detail: `These functions are connected to Supabase project: ${supabaseUrl} — compare this against Project Settings → API → Project URL for the project your website actually uses.` },
      ];
      if (storeId) {
        const { data: storeRow, error: storeErr } = await admin.from("stores").select("id").eq("id", storeId).maybeSingle();
        const found = Boolean(storeRow) && !storeErr;
        dbSteps.push({
          step: "store_lookup",
          ok: found,
          detail: found
            ? `Found store ${storeId} in this database.`
            : `Store ${storeId} was NOT found in this database${storeErr ? ` (${storeErr.message})` : ""}. If you can see and edit this exact store on the live site, these functions are almost certainly deployed to the WRONG Supabase project — run "supabase projects list" / check which project "supabase link" points to, re-link to the correct one, then redeploy both functions.`,
        });
      }
      return json({ ok: gh.ok && dbSteps.every((s) => s.ok), steps: [...dbSteps, ...gh.steps] });
    }

    if (!GH_TOKEN || !GH_REPO) return json({ error: "server_not_configured" }, 500);
    if (!storeId || !["upload", "remove"].includes(action ?? "")) return json({ error: "bad_request" }, 400);

    // 2. Which store, and may they touch it?
    const { data: store } = await admin.from("stores").select("id, owner_id, logo_path").eq("id", storeId).maybeSingle();
    if (!store) return json({ error: "store_not_found" }, 404);
    let allowed = store.owner_id === uid;
    if (!allowed) {
      const { data: prof } = await admin.from("profiles").select("role").eq("id", uid).maybeSingle();
      allowed = prof?.role === "super_admin";
    }
    if (!allowed) return json({ error: "forbidden" }, 403);

    const oldPath: string | null = store.logo_path ?? null;

    // 3a. Remove
    if (action === "remove") {
      if (oldPath && !(await deleteFile(oldPath, `Remove logo for store ${storeId}`))) return json({ error: "github_delete_failed" }, 502);
      await admin.from("stores").update({ logo_url: null, logo_path: null }).eq("id", storeId);
      return json({ ok: true, logoUrl: null });
    }

    // 3b. Upload / replace
    if (!image || typeof image !== "string") return json({ error: "no_image" }, 400);
    const bytes = Uint8Array.from(atob(image.replace(/^data:image\/webp;base64,/, "")), (c) => c.charCodeAt(0));
    if (bytes.length > MAX_BYTES) return json({ error: "too_large" }, 413);
    if (!isWebp(bytes)) {
      const head = Array.from(bytes.subarray(0, 16)).map((b) => b.toString(16).padStart(2, "0")).join(" ");
      return json({ error: "not_webp", detail: `Received ${bytes.length} bytes; first 16 hex: ${head || "(empty)"}. Expected them to start with "52 49 46 46" (RIFF).` }, 415);
    }

    const path = `${FOLDER}/${storeId}-${await shortHash(bytes)}.webp`;
    if (path === oldPath) return json({ ok: true, logoUrl: rawUrl(path), unchanged: true });

    const put = await putFile(path, bytes, `Add logo for store ${storeId}`);
    if (!put.ok && put.status !== 422 /* 422 = identical path already exists */) {
      const detail = await put.text().catch(() => "");
      console.error("GitHub PUT failed", put.status, detail);
      return json({ error: "github_upload_failed", status: put.status, detail }, 502);
    }

    const { error: dbErr } = await admin.from("stores").update({ logo_url: rawUrl(path), logo_path: path }).eq("id", storeId);
    if (dbErr) {
      console.error("DB update failed", dbErr);
      await deleteFile(path, `Roll back logo for store ${storeId}`);
      return json({ error: "db_update_failed", detail: dbErr.message }, 500);
    }

    // Only now is it safe to drop the previous file.
    if (oldPath) await deleteFile(oldPath, `Replace logo for store ${storeId}`).catch((e) => console.error("old logo cleanup failed", e));

    return json({ ok: true, logoUrl: rawUrl(path) });
  } catch (e) {
    console.error("upload-store-logo error", e);
    return json({ error: "server_error", detail: String((e as any)?.message ?? e) }, 500);
  }
});
