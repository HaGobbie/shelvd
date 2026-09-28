// src/utils/imageToWebp.js
// Shrinks + converts an image file to WebP in the browser BEFORE it is sent
// anywhere, so what gets stored in the repo is small (typically 10–60 KB).
//
//  • Fits inside maxSize × maxSize, keeping aspect ratio (no cropping).
//  • Transparency is kept (WebP supports it).
//  • Tries quality 0.85 and steps down until the file is under targetBytes.
//  • Very old browsers that can't ENCODE webp from a canvas (older Safari)
//    return a PNG instead — we detect that and throw "webp_unsupported"
//    rather than silently storing a big PNG.

const DEFAULT_MAX = 512;
const DEFAULT_TARGET = 100 * 1024;

function loadBitmap(file) {
  if (window.createImageBitmap) return createImageBitmap(file).catch(() => loadViaImg(file));
  return loadViaImg(file);
}
function loadViaImg(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("bad_image")); };
    img.src = url;
  });
}
const toBlob = (canvas, quality) => new Promise((res) => canvas.toBlob(res, "image/webp", quality));

export async function imageFileToWebp(file, { maxSize = DEFAULT_MAX, targetBytes = DEFAULT_TARGET } = {}) {
  if (!file || !file.type.startsWith("image/")) throw new Error("not_image");
  const bmp = await loadBitmap(file);
  const w0 = bmp.width, h0 = bmp.height;
  if (!w0 || !h0) throw new Error("bad_image");

  const scale = Math.min(1, maxSize / Math.max(w0, h0));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w0 * scale));
  canvas.height = Math.max(1, Math.round(h0 * scale));
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  if (bmp.close) bmp.close();

  let quality = 0.85;
  let blob = await toBlob(canvas, quality);
  if (!blob || blob.type !== "image/webp") throw new Error("webp_unsupported");
  while (blob.size > targetBytes && quality > 0.35) {
    quality -= 0.1;
    blob = await toBlob(canvas, quality);
  }
  return { blob, width: canvas.width, height: canvas.height };
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = () => reject(new Error("read_failed"));
    r.readAsDataURL(blob);
  });
}
