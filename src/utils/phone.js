// src/utils/phone.js
// Philippine mobile-number rules used by store registration and store edit.
//
// Accepted:  09XXXXXXXXX (11 digits). "+63 9XX XXX XXXX" and "639XXXXXXXXX"
// are normalized to the 09… form. Digits only — letters and symbols are
// stripped as the person types.
//
// Landlines are intentionally not accepted (sari-sari stores are almost
// always reached by mobile). To allow them, loosen isValidPHPhone() below.

export const PH_PHONE_LENGTH = 11;

/** Strip everything that isn't a digit and cap the length. Use in onChange. */
export function sanitizePhoneInput(raw) {
  return String(raw ?? "").replace(/\D/g, "").slice(0, PH_PHONE_LENGTH);
}

/** Turn +639XXXXXXXXX / 639XXXXXXXXX / 9XXXXXXXXX into 09XXXXXXXXX. */
export function normalizePHPhone(raw) {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.startsWith("63") && digits.length === 12) return "0" + digits.slice(2);
  if (digits.startsWith("9") && digits.length === 10) return "0" + digits;
  return digits;
}

export function isValidPHPhone(raw) {
  return /^09\d{9}$/.test(normalizePHPhone(raw));
}

/** Returns "empty" | "invalid" | null (null = OK). */
export function phoneProblem(raw) {
  const v = String(raw ?? "").trim();
  if (!v) return "empty";
  return isValidPHPhone(v) ? null : "invalid";
}
