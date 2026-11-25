/**
 * Matching the material text printed on a drawing ("304L SS", "EN 8", "SS-316") to a grade in
 * the material master. Drawings never write the grade the way the master stores it, so an exact
 * string comparison almost never matched and the grade was left blank.
 */

/** "AS PER BOM", "TBD", "N/A" … — the drawing names no real grade. */
export function isPlaceholderGrade(text: string | null | undefined): boolean {
  const t = (text ?? '').trim();
  return !t || /\bas per\b|\bbom\b|\bstandard\b|\btbd\b|^n\/?a$|\brefer\b|\bnot specified\b/i.test(t);
}

/** Upper-case letters and digits only: "EN 8" / "en-8" / "EN8" all become "EN8". */
export const normGrade = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

// Words that describe the material family rather than name the grade ("304L SS" == "SS304L").
const NOISE = /STAINLESS|STEEL|GRADE|GRD|SS|GR/g;
const core = (s: string): string => normGrade(s).replace(NOISE, '');

/**
 * The master grade that the drawing text refers to, or null when there is none / it is ambiguous.
 *  1. the same grade ignoring case, spaces and punctuation;
 *  2. the same grade ignoring family words (SS, STEEL, GRADE…);
 *  3. the longest grade code (≥ 3 characters) that appears inside the text — "304L SS ANNEALED" → 304L.
 * A tie for the longest code is ambiguous, so nothing is chosen and the estimator picks.
 */
export function matchGrade<T extends { gradeCode: string }>(text: string | null | undefined, grades: T[]): T | null {
  if (isPlaceholderGrade(text)) return null;
  const n = normGrade(text!);
  const c = core(text!);
  if (!n) return null;

  const exact = grades.filter((g) => normGrade(g.gradeCode) === n);
  if (exact.length === 1) return exact[0];

  const loose = c ? grades.filter((g) => core(g.gradeCode) === c) : [];
  if (loose.length === 1) return loose[0];

  let best: T[] = [];
  let bestLen = 0;
  for (const g of grades) {
    const code = core(g.gradeCode) || normGrade(g.gradeCode);
    if (code.length < 3 || !(n.includes(code) || (c && c.includes(code)))) continue;
    if (code.length > bestLen) {
      best = [g];
      bestLen = code.length;
    } else if (code.length === bestLen) best.push(g);
  }
  return best.length === 1 ? best[0] : null;
}
