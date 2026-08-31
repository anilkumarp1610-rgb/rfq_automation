/**
 * The customer part number is usually in the spec file name
 * (e.g. `P01273549.pdf`, `P01273549 rev A.pdf`, `SEPL-P01273549.pdf`).
 */
export function partNumberFromFilename(filename: string): string | null {
  const base = filename.replace(/\.[a-z0-9]+$/i, '').trim();

  // a code-like token: letters then a long run of digits
  const code = base.match(/([A-Za-z]{1,4}\d{4,})/);
  if (code) return code[1].toUpperCase();

  // a bare long digit run
  const digits = base.match(/\b(\d{6,})\b/);
  if (digits) return digits[1];

  // otherwise the whole basename if it looks like an id (single token with a digit)
  if (/^[A-Za-z0-9][\w-]{2,40}$/.test(base) && /\d/.test(base)) return base.toUpperCase();

  return null;
}
