// supabase/functions/upload-store-photo/index.ts
//
// Adds/removes photos of what a store looks like, stored one-per-file at
// public/store-photos/<storeId>/<contenthash>.webp, with metadata (url, path,
// position) in public.store_photos (sql/032). Up to MAX_PHOTOS per store.
//
// Shares GitHub setup + secrets with upload-store-logo — see that function's
// header for the one-time setup steps (same GITHUB_TOKEN / GITHUB_REPO /
// GITHUB_BRANCH secrets; deploy this as its own function too:
//   supabase functions deploy upload-store-photo
// { action: "diagnose" } here checks the same GitHub credentials.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GH_TOKEN, GH_REPO, putFile, deleteFile, isWebp, shortHash, rawUrl, diagnose } from "../_shared/githubStorage.ts";

const ALLOWED_ORIGIN = "*";
const FOLDER = "public/store-photos";
const MAX_BYTES = 400 * 1024;
const MAX_PHOTOS = 6;

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
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);
    const uid = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const { action, storeId, image, photoId } = body as { action?: string; storeId?: string; image?: string; photoId?: string };

    if (action === "diagnose") return json(await diagnose());
    if (!GH_TOKEN || !GH_REPO) return json({ error: "server_not_configured" }, 500);
    if (!storeId || !["upload", "remove"].includes(action ?? "")) return json({ error: "bad_request" }, 400);

    const { data: store } = await admin.from("stores").select("id, owner_id").eq("id", storeId).maybeSingle();
    if (!store) return json({ error: "store_not_found" }, 404);
    let allowed = store.owner_id === uid;
    if (!allowed) {
      const { data: prof } = await admin.from("profiles").select("role").eq("id", uid).maybeSingle();
      allowed = prof?.role === "super_admin";
    }
    if (!allowed) return json({ error: "forbidden" }, 403);

    // ── Remove one photo ──
    if (action === "remove") {
      if (!photoId) return json({ error: "bad_request" }, 400);
      const { data: photo } = await admin.from("store_photos").select("id, photo_path").eq("id", photoId).eq("store_id", storeId).maybeSingle();
      if (!photo) return json({ error: "photo_not_found" }, 404);
      if (!(await deleteFile(photo.photo_path, `Remove photo for store ${storeId}`))) return json({ error: "github_delete_failed" }, 502);
      await admin.from("store_photos").delete().eq("id", photoId);
      return json({ ok: true });
    }

    // ── Add a photo ──
    const { count } = await admin.from("store_photos").select("id", { count: "exact", head: true }).eq("store_id", storeId);
    if ((count ?? 0) >= MAX_PHOTOS) return json({ error: "too_many_photos", max: MAX_PHOTOS }, 409);

    if (!image || typeof image !== "string") return json({ error: "no_image" }, 400);
    const bytes = Uint8Array.from(atob(image.replace(/^data:image\/webp;base64,/, "")), (c) => c.charCodeAt(0));
    if (bytes.length > MAX_BYTES) return json({ error: "too_large" }, 413);
    if (!isWebp(bytes)) return json({ error: "not_webp" }, 415);

    const path = `${FOLDER}/${storeId}/${await shortHash(bytes)}.webp`;
    const put = await putFile(path, bytes, `Add photo for store ${storeId}`);
    if (!put.ok && put.status !== 422) {
      const detail = await put.text().catch(() => "");
      console.error("GitHub PUT failed", put.status, detail);
      return json({ error: "github_upload_failed", status: put.status, detail }, 502);
    }

    const url = rawUrl(path);
    const { data: row, error: dbErr } = await admin
      .from("store_photos")
      .insert({ store_id: storeId, photo_url: url, photo_path: path, position: count ?? 0 })
      .select("id, photo_url, position")
      .single();
    if (dbErr) {
      console.error("DB insert failed", dbErr);
      await deleteFile(path, `Roll back photo for store ${storeId}`);
      return json({ error: "db_update_failed", detail: dbErr.message }, 500);
    }

    return json({ ok: true, photo: { id: row.id, url: row.photo_url, position: row.position } });
  } catch (e) {
    console.error("upload-store-photo error", e);
    return json({ error: "server_error", detail: String((e as any)?.message ?? e) }, 500);
  }
});
