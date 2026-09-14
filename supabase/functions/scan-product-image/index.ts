// supabase/functions/scan-product-image/index.ts
//
// "AI Snap & Fill" backend for ProductFormModal.jsx. Takes a resized,
// base64-encoded product/service photo from the owner's camera and
// returns a structured {name, category, unit, estimated_price,
// is_service} guess from Gemini.
//
// WHY THIS EXISTS AS A SERVER FUNCTION AND NOT A DIRECT CLIENT CALL:
// Shelvd is a static Vite build deployed to GitHub Pages — there is no
// server to hide a secret in on the client side. Any `VITE_*` env var
// gets inlined into the shipped JS bundle at build time, so a Gemini key
// used directly from src/services/geminiScanner.js would be plainly
// readable by anyone who opens dev tools. This function is the fix:
// GEMINI_API_KEY lives ONLY as a Supabase Edge Function secret (set via
// `supabase secrets set`, see deployment notes below) and never appears
// in any file the browser downloads. The client calls this function by
// name via supabase.functions.invoke(...); the real key never leaves
// Supabase's infrastructure.
//
// AUTH (not rate limiting): Supabase Edge Functions verify the caller's
// JWT by default — this function does NOT set `--no-verify-jwt` on
// deploy, so only requests carrying a valid Supabase Auth session
// (i.e. a signed-in store owner, which is the only context
// ProductFormModal ever renders in) can reach this code at all. That's
// authentication, not throttling — per your instruction, there is
// deliberately no per-store or per-day request cap here. If you ever
// want that later, this is the file to add it to (e.g. counting rows in
// a new `scan_events` table per store_id), but nothing like that exists
// today.
//
// MODEL FALLBACK: tries gemini-3.5-flash-lite first; on a 429 (rate
// limited), retries once against gemini-3.1-flash-lite. Both are real,
// current Gemini models (verified against Google's docs as of Sept
// 2026) from two different generations, so they draw from separate
// quota pools — a genuine fallback, not just cosmetic.
//
// DEPLOYMENT (one-time):
//   1. supabase functions deploy scan-product-image
//      (default JWT verification stays ON — do NOT pass --no-verify-jwt)
//   2. supabase secrets set GEMINI_API_KEY=your-key-here
//   3. Lock the CORS origin below down to your actual GitHub Pages URL
//      once you know it (see ALLOWED_ORIGIN).

// deno-lint-ignore-file no-explicit-any

// ── CORS ────────────────────────────────────────────────────────────────────
// Tighten this to your real deployed origin, e.g.
// "https://your-username.github.io", once you know it. "*" works for
// testing but allows any website to call this function (though it still
// can't do anything useful without a valid Supabase session — see the
// AUTH note above).
const ALLOWED_ORIGIN = "*";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// ── Gemini config ────────────────────────────────────────────────────────────
const PRIMARY_MODEL = "gemini-3.5-flash-lite";
const FALLBACK_MODEL = "gemini-3.1-flash-lite";

// Keep this list in sync with CATEGORIES / SERVICE_CATEGORIES in
// src/components/ProductFormModal.jsx. The client re-validates whatever
// Gemini returns against its own copy of this list regardless (never
// trusts this blindly), but keeping the model's enum aligned means fewer
// results fall back to "Other" in the first place.
const CATEGORY_ENUM = [
  "Pantry", "Grains", "Canned Goods", "Beverages", "Condiments",
  "Dairy & Eggs", "Household", "Personal Care", "Snacks", "Frozen Goods",
  "Water Refill", "E-Load", "LPG / Cooking Gas", "Ice", "Other",
];

const SYSTEM_PROMPT =
  "You are an accurate retail image scanner for neighborhood micro-merchants " +
  "in the Philippines. Analyze the provided product or service packaging " +
  "image. Extract a clean, short product title (as it would appear on a " +
  "price tag, not the full marketing text on the package), map it to the " +
  "single closest allowed category, determine the most natural selling " +
  "unit, and estimate the price ONLY if a price is clearly printed/visible " +
  "on the packaging or a shelf tag in the image — otherwise return null for " +
  "price rather than guessing. Set is_service to true only for Water " +
  "Refill, LPG / Cooking Gas, Ice, or E-Load. If the image is unclear, " +
  "blurry, or doesn't show a retail product/service, still return your " +
  "best-guess JSON rather than refusing, using \"Other\" as the category " +
  "if nothing else fits.";

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    name: { type: "STRING" },
    category: { type: "STRING", enum: CATEGORY_ENUM },
    unit: { type: "STRING" },
    estimated_price: { type: "NUMBER", nullable: true },
    is_service: { type: "BOOLEAN" },
  },
  required: ["name", "category", "unit", "is_service"],
};

async function callGemini(model: string, apiKey: string, base64Image: string, mimeType: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  return await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [
        {
          role: "user",
          parts: [
            { text: "Analyze this image and return the structured JSON described in your instructions." },
            { inlineData: { mimeType, data: base64Image } },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    }),
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    console.error("GEMINI_API_KEY is not set as an Edge Function secret.");
    return jsonResponse({ error: "Image scanning isn't configured on the server yet." }, 500);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  const { image, mimeType } = body ?? {};
  if (!image || typeof image !== "string") {
    return jsonResponse({ error: "Missing 'image' (base64 string, no data: prefix)." }, 400);
  }

  // Sanity bound only — NOT rate limiting. The client resizes images to
  // ~1024px before sending, so a legitimate request is well under a
  // couple hundred KB of base64. This just guards against something
  // absurd (e.g. a full-resolution photo bypassing the client resize)
  // eating unnecessary Gemini input-token cost on one single call.
  if (image.length > 8_000_000) {
    return jsonResponse({ error: "Image is too large. Please try a smaller photo." }, 413);
  }

  const safeMimeType = typeof mimeType === "string" && mimeType.startsWith("image/")
    ? mimeType
    : "image/jpeg";

  try {
    let res = await callGemini(PRIMARY_MODEL, apiKey, image, safeMimeType);
    let usedModel = PRIMARY_MODEL;

    if (res.status === 429) {
      console.warn(`${PRIMARY_MODEL} rate-limited (429) — retrying with ${FALLBACK_MODEL}`);
      res = await callGemini(FALLBACK_MODEL, apiKey, image, safeMimeType);
      usedModel = FALLBACK_MODEL;
    }

    if (!res.ok) {
      const errText = await res.text();
      console.error(`Gemini API error via ${usedModel} (${res.status}):`, errText);
      return jsonResponse(
        { error: "Image scan failed. Please try again or enter the details manually." },
        502,
      );
    }

    const data = await res.json();
    const textPart = data?.candidates?.[0]?.content?.parts?.find((p: any) => typeof p.text === "string")?.text;
    if (!textPart) {
      console.error(`Gemini response via ${usedModel} had no text part:`, JSON.stringify(data));
      return jsonResponse({ error: "Scan returned no result. Please try again." }, 502);
    }

    let parsed: any;
    try {
      parsed = JSON.parse(textPart);
    } catch {
      console.error(`Gemini response via ${usedModel} was not valid JSON:`, textPart);
      return jsonResponse({ error: "Scan returned an unreadable result. Please try again." }, 502);
    }

    return jsonResponse({ result: parsed, model: usedModel });
  } catch (err) {
    console.error("scan-product-image unexpected failure:", err);
    return jsonResponse({ error: "Unexpected error while scanning the image." }, 500);
  }
});
