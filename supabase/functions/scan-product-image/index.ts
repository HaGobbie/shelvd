// supabase/functions/scan-receipt-image/index.ts
//
// Backend for BulkImportModal.jsx's "Scan a Receipt" path. Takes a
// resized, base64-encoded photo of a wholesaler receipt/invoice and
// returns an ARRAY of line items — the multi-item sibling of
// scan-product-image (which returns one product from one package photo).
// Kept as a separate function rather than a mode flag on that one:
// the prompt, response schema (array vs single object), and the whole
// idea of what "confidence" means are different enough that bolting
// this onto scan-product-image would make one function do two
// unrelated jobs. Shares its security model exactly: GEMINI_API_KEY is
// an Edge Function secret only, JWT verification stays on by default
// (do NOT deploy with --no-verify-jwt), same two-model fallback.
//
// WHY THIS IS HARDER THAN scan-product-image, AND WHY THAT'S OKAY:
// A single product photo shows clean, well-lit packaging design. A
// receipt is much messier — faded thermal print, heavy abbreviation
// ("CORNBF 150G"), and a qty/unit-price/total-price layout the model
// has to correctly disentangle per line. Expect a meaningfully higher
// error rate than the single-product scanner. That's why every item
// here carries a `low_confidence` flag: BulkImportModal turns that into
// a normal validation error, which means an uncertain line just lands
// in the SAME flagged-first review cards as a bad CSV row — the review
// UI is the safety net, not a perfect extraction.
//
// DEPLOYMENT (one-time):
//   1. supabase functions deploy scan-receipt-image
//      (default JWT verification stays ON)
//   2. GEMINI_API_KEY is shared with scan-product-image — if that
//      secret is already set, nothing more to do:
//        supabase secrets set GEMINI_API_KEY=your-key-here
//   3. Lock ALLOWED_ORIGIN down to your real GitHub Pages URL once known
//      (same note as scan-product-image).

// deno-lint-ignore-file no-explicit-any

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

const PRIMARY_MODEL = "gemini-3.5-flash-lite";
const FALLBACK_MODEL = "gemini-3.1-flash-lite";

// Keep in sync with CATEGORIES in src/constants/productCategories.js.
// The client re-validates against its own copy regardless (never trusts
// this blindly) — see normalizeCategory() in geminiScanner.js.
const CATEGORY_ENUM = [
  "Pantry", "Grains", "Canned Goods", "Beverages", "Condiments",
  "Dairy & Eggs", "Household", "Personal Care", "Snacks", "Frozen Goods",
  "Water Refill", "E-Load", "LPG / Cooking Gas", "Ice", "Other",
];

const SYSTEM_PROMPT =
  "You are reading a wholesaler or grocery receipt photo for a Philippine " +
  "neighborhood micro-merchant restocking their store. Extract every " +
  "PURCHASED LINE ITEM as a separate entry. Do NOT include the store's " +
  "name/address/header, the subtotal, tax (VAT), discount, total amount " +
  "due, cash tendered, change, or any payment/loyalty-program text — " +
  "those are not products. For each genuine line item: " +
  "(1) name — clean up spacing/capitalization only; do not guess an " +
  "expansion of an abbreviation unless you are confident (e.g. leave " +
  "\"CORNBF 150G\" mostly as-is rather than inventing a full product name " +
  "you are not sure of). " +
  "(2) category — the single closest match from the allowed list. " +
  "(3) unit — the most natural selling unit for this item (piece, pack, " +
  "kg, bottle, etc). " +
  "(4) quantity — the number of units purchased on that line. " +
  "(5) unit_price — the price PER UNIT, not the line total. Many receipts " +
  "print quantity, unit price, AND a line total together — if only a line " +
  "total is printed alongside quantity, compute unit_price = total / " +
  "quantity yourself rather than returning the total. If you cannot " +
  "confidently determine a price at all, return null rather than " +
  "guessing. " +
  "(6) low_confidence — set true if ANY of the name, quantity, or price " +
  "for this specific line is unclear, blurry, cut off, or ambiguous — be " +
  "honest and generous about flagging uncertainty here, since a human " +
  "will review every flagged line before anything is saved. " +
  "Return an empty array if the image does not look like a receipt at all.";

const RESPONSE_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      name: { type: "STRING" },
      category: { type: "STRING", enum: CATEGORY_ENUM },
      unit: { type: "STRING" },
      quantity: { type: "NUMBER" },
      unit_price: { type: "NUMBER", nullable: true },
      low_confidence: { type: "BOOLEAN" },
    },
    required: ["name", "category", "unit", "quantity", "low_confidence"],
  },
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
            { text: "Extract every line item from this receipt as the structured JSON array described in your instructions." },
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
    return jsonResponse({ error: "Receipt scanning isn't configured on the server yet." }, 500);
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
  // Sanity bound only, not rate limiting — a receipt is resized larger
  // than a single-product photo client-side (more text to keep legible),
  // so this ceiling is higher than scan-product-image's.
  if (image.length > 12_000_000) {
    return jsonResponse({ error: "Image is too large. Please try a smaller or less detailed photo." }, 413);
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
        { error: "Couldn't read that receipt. Please try again or add items manually." },
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

    if (!Array.isArray(parsed)) {
      console.error(`Gemini response via ${usedModel} was not an array:`, textPart);
      return jsonResponse({ error: "Scan returned an unexpected result. Please try again." }, 502);
    }

    return jsonResponse({ items: parsed, model: usedModel });
  } catch (err) {
    console.error("scan-receipt-image unexpected failure:", err);
    return jsonResponse({ error: "Unexpected error while scanning the receipt." }, 500);
  }
});
