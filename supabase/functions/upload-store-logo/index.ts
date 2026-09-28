// supabase/functions/upload-store-logo/index.ts
//
// Stores a store's logo as a .webp file inside your GitHub repo
// (public/store-logos/<storeId>-<contenthash>.webp) and keeps stores.logo_url
// pointing at it. Replacing a logo commits the new file, updates the store,
// THEN deletes the old file — so a failure part-way never leaves a store
// without a logo.
//
// WHY AN EDGE FUNCTION: writing to a GitHub repo needs a token. Anything in the
// React app ships to every visitor's browser, so a token there would be public
// and anyone could rewrite your repo. The token lives ONLY here, as a secret.
//
// The browser already converts + shrinks the image to WebP (src/utils/imageToWebp.js);
// this function re-validates everything (never trusts the client): caller is
// signed in, owns the store (or is a super admin), file really is a WebP, small.
//
// URL: https://raw.githubusercontent.com/<repo>/<branch>/public/store-logos/<file>.webp
// Live right after the commit — no site rebuild needed (the deploy workflow
// ignores this folder, see .github/workflows/deploy.yml).
//
// ─── ONE-TIME SETUP ───────────────────────────────────────────────────────
//  1. GitHub → Settings → Developer settings → Fine-grained personal access
//     tokens → Generate. Repository access: ONLY HaGobbie/shelvd.
//     Permissions → Repository permissions → Contents: Read and write.
//  2. supabase secrets set GITHUB_TOKEN=github_pat_xxx GITHUB_REPO=HaGobbie/shelvd GITHUB_BRANCH=main
//  3. supabase functions deploy upload-store-logo      (keep JWT verification ON)
//  (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.)
//  4. Lock ALLOWED_ORIGIN below to your Pages URL (e.g. https://hagobbie.github.io).

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

const GH_TOKEN = Deno.env.get("GITHUB_TOKEN") ?? "";
const GH_REPO = Deno.env.get("GITHUB_REPO") ?? "";
const GH_BRANCH = Deno.env.get("GITHUB_BRANCH") ?? "main";
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const ghHeaders = {
  Authorization: `Bearer ${GH_TOKEN}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "shelvd-logo-uploader",
};
const ghUrl = (path: string) => `https://api.github.com/repos/${GH_REPO}/contents/${path.split("/").map(encodeURIComponent).join("/")}`;
const rawUrl = (path: string) => `https://raw.githubusercontent.com/${GH_REPO}/${GH_BRANCH}/${path}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GitHub returns 409 if two commits race on the same branch — retry a couple of times. */
async function ghWithRetry(fn: () => Promise<Response>): Promise<Response> {
  let res = await fn();
  for (let i = 0; i < 2 && res.status === 409; i++) { await sleep(600 * (i + 1)); res = await fn(); }
  return res;
}

async function putFile(path: string, bytes: Uint8Array, message: string) {
  let b64 = ""; const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) b64 += String.fromCharCode(...bytes.subarray(i, i + CH));
  b64 = btoa(b64);
  return ghWithRetry(() => fetch(ghUrl(path), {
    method: "PUT", headers: ghHeaders,
    body: JSON.stringify({ message, content: b64, branch: GH_BRANCH }),
  }));
}

/** Deletes a file if it exists. Missing file = success. Returns true on success. */
async function deleteFile(path: string, message: string): Promise<boolean> {
  const get = await fetch(`${ghUrl(path)}?ref=${GH_BRANCH}`, { headers: ghHeaders });
  if (get.status === 404) return true;
  if (!get.ok) return false;
  const { sha } = await get.json();
  const del = await ghWithRetry(() => fetch(ghUrl(path), {
    method: "DELETE", headers: ghHeaders, body: JSON.stringify({ message, sha, branch: GH_BRANCH }),
  }));
  return del.ok || del.status === 404;
}

const isWebp = (b: Uint8Array) =>
  b.length > 12 && String.fromCharCode(...b.subarray(0, 4)) === "RIFF" && String.fromCharCode(...b.subarray(8, 12)) === "WEBP";

async function shortHash(bytes: Uint8Array) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...d].slice(0, 5).map((x) => x.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!GH_TOKEN || !GH_REPO) return json({ error: "server_not_configured" }, 500);

  try {
    // 1. Who is calling?
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);
    const uid = userData.user.id;

    // 2. Which store, and may they touch it?
    const body = await req.json().catch(() => ({}));
    const { action, storeId, image } = body as { action?: string; storeId?: string; image?: string };
    if (!storeId || !["upload", "remove"].includes(action ?? "")) return json({ error: "bad_request" }, 400);

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
    if (!isWebp(bytes)) return json({ error: "not_webp" }, 415);

    const path = `${FOLDER}/${storeId}-${await shortHash(bytes)}.webp`;
    if (path === oldPath) return json({ ok: true, logoUrl: rawUrl(path), unchanged: true });

    const put = await putFile(path, bytes, `Add logo for store ${storeId}`);
    if (!put.ok && put.status !== 422 /* 422 = identical path already exists */) {
      console.error("GitHub PUT failed", put.status, await put.text());
      return json({ error: "github_upload_failed" }, 502);
    }

    const { error: dbErr } = await admin.from("stores").update({ logo_url: rawUrl(path), logo_path: path }).eq("id", storeId);
    if (dbErr) {
      console.error("DB update failed", dbErr);
      await deleteFile(path, `Roll back logo for store ${storeId}`);
      return json({ error: "db_update_failed" }, 500);
    }

    // Only now is it safe to drop the previous file.
    if (oldPath) await deleteFile(oldPath, `Replace logo for store ${storeId}`).catch((e) => console.error("old logo cleanup failed", e));

    return json({ ok: true, logoUrl: rawUrl(path) });
  } catch (e) {
    console.error("upload-store-logo error", e);
    return json({ error: "server_error" }, 500);
  }
});
