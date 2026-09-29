// supabase/functions/_shared/githubStorage.ts
// Shared GitHub-as-a-file-store helper for upload-store-logo and
// upload-store-photo. See either function's header comment for the ONE-TIME
// SETUP steps (GitHub token + secrets) — both functions need the same three
// secrets: GITHUB_TOKEN, GITHUB_REPO, GITHUB_BRANCH.

export const GH_TOKEN = Deno.env.get("GITHUB_TOKEN") ?? "";
export const GH_REPO = Deno.env.get("GITHUB_REPO") ?? "";
export const GH_BRANCH = Deno.env.get("GITHUB_BRANCH") ?? "main";

const ghHeaders = {
  Authorization: `Bearer ${GH_TOKEN}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "shelvd-image-uploader",
};
const ghUrl = (path: string) => `https://api.github.com/repos/${GH_REPO}/contents/${path.split("/").map(encodeURIComponent).join("/")}`;
export const rawUrl = (path: string) => `https://raw.githubusercontent.com/${GH_REPO}/${GH_BRANCH}/${path}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GitHub returns 409 if two commits race on the same branch — retry a couple of times. */
async function ghWithRetry(fn: () => Promise<Response>): Promise<Response> {
  let res = await fn();
  for (let i = 0; i < 2 && res.status === 409; i++) { await sleep(600 * (i + 1)); res = await fn(); }
  return res;
}

export async function putFile(path: string, bytes: Uint8Array, message: string) {
  let b64 = ""; const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) b64 += String.fromCharCode(...bytes.subarray(i, i + CH));
  b64 = btoa(b64);
  return ghWithRetry(() => fetch(ghUrl(path), {
    method: "PUT", headers: ghHeaders,
    body: JSON.stringify({ message, content: b64, branch: GH_BRANCH }),
  }));
}

/** Deletes a file if it exists. Missing file = success. Returns true on success. */
export async function deleteFile(path: string, message: string): Promise<boolean> {
  const get = await fetch(`${ghUrl(path)}?ref=${GH_BRANCH}`, { headers: ghHeaders });
  if (get.status === 404) return true;
  if (!get.ok) return false;
  const { sha } = await get.json();
  const del = await ghWithRetry(() => fetch(ghUrl(path), {
    method: "DELETE", headers: ghHeaders, body: JSON.stringify({ message, sha, branch: GH_BRANCH }),
  }));
  return del.ok || del.status === 404;
}

export const isWebp = (b: Uint8Array) =>
  b.length > 12 && String.fromCharCode(...b.subarray(0, 4)) === "RIFF" && String.fromCharCode(...b.subarray(8, 12)) === "WEBP";

export async function shortHash(bytes: Uint8Array) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...d].slice(0, 5).map((x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * diagnose — a harmless read-only check the client can call to tell WHY
 * uploads keep failing, without needing to read the Supabase function logs.
 * Checks, in order: secrets present → token authenticates → token can see
 * the configured repo → the configured branch exists.
 */
export async function diagnose() {
  const steps: Array<{ step: string; ok: boolean; detail: string }> = [];
  steps.push({ step: "secrets", ok: Boolean(GH_TOKEN && GH_REPO), detail: GH_TOKEN && GH_REPO ? "GITHUB_TOKEN and GITHUB_REPO are set." : "Missing GITHUB_TOKEN and/or GITHUB_REPO. Run: supabase secrets set GITHUB_TOKEN=... GITHUB_REPO=owner/repo GITHUB_BRANCH=main, then redeploy the function." });
  if (!steps[0].ok) return { ok: false, steps };

  const who = await fetch("https://api.github.com/user", { headers: ghHeaders }).catch((e) => ({ ok: false, status: 0, _err: e }));
  const whoOk = "status" in who && who.status === 200;
  steps.push({ step: "token", ok: whoOk, detail: whoOk ? "Token authenticates with GitHub." : `Token rejected by GitHub (status ${("status" in who && who.status) || "network error"}). It may be expired, revoked, or malformed.` });
  if (!whoOk) return { ok: false, steps };

  const repo = await fetch(`https://api.github.com/repos/${GH_REPO}`, { headers: ghHeaders }).catch((e) => ({ ok: false, status: 0, _err: e }));
  const repoOk = "status" in repo && repo.status === 200;
  steps.push({ step: "repo", ok: repoOk, detail: repoOk ? `Token can see ${GH_REPO}.` : `Can't access repo "${GH_REPO}" (status ${("status" in repo && repo.status) || "network error"}). Check GITHUB_REPO is exactly "owner/repo" and the token's repository access includes it, with Contents: Read and write.` });
  if (!repoOk) return { ok: false, steps };

  const repoJson = await (repo as Response).json();
  const defaultBranch = repoJson.default_branch;
  const branch = await fetch(`https://api.github.com/repos/${GH_REPO}/branches/${GH_BRANCH}`, { headers: ghHeaders }).catch((e) => ({ ok: false, status: 0, _err: e }));
  const branchOk = "status" in branch && branch.status === 200;
  steps.push({ step: "branch", ok: branchOk, detail: branchOk ? `Branch "${GH_BRANCH}" exists.` : `Branch "${GH_BRANCH}" not found (repo's default branch is "${defaultBranch}"). Set GITHUB_BRANCH="${defaultBranch}" or create a "${GH_BRANCH}" branch.` });

  return { ok: steps.every((s) => s.ok), steps };
}
