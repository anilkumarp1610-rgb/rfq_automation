import type { SpecExtractResult } from '@rfq/shared';
import { isPlaceholderGrade } from './grade.js';
import type { PageText, Seg } from './textLayer.js';

/**
 * Reads the title block of a drawing from its text layer — no AI, no cost. It finds the printed labels
 * (TITLE, MATERIAL, DRAWING NO. …) and takes the value written beside or under each one.
 * Deliberately modest: it captures the identity of the part (drawing no., item name, material grade, units,
 * stock size). Dimensions, tolerances and notes need the AI reader, and the result says so.
 */

const norm = (t: string) => t.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/** Words that head a title-block cell — never a value. */
const LABELS = new Set(
  [
    'TITLE', 'MATERIAL', 'MATERIAL GRADE', 'DRAWING NO', 'DRAWING NUMBER', 'DWG NO', 'DRG NO', 'PART NO', 'PART NUMBER',
    'CUSTOMER', 'CO NO', 'DESIGNED', 'DETAILED', 'CHECKED', 'DRAWN', 'MODELED', 'APPROVED', 'SCALE', 'SHEET', 'SHEET NO',
    'REV', 'REVISION', 'DATE', 'WEIGHT', 'DESCRIPTION', 'ITEM', 'QTY', 'SIZE', 'TOLERANCES', 'FINISH', 'SIMILAR', 'SOURCE',
    'DASH', 'PSM', 'MAN', 'SP', 'NOTES', 'PART NAME', 'ITEM NAME', 'DRAWING TITLE', 'UNITS', 'PROJECT', 'MATL', 'ANGULAR',
    'FRACTIONAL', 'DECIMAL', 'MACH', 'FAB', 'TYP', 'UNLESS OTHERWISE SPECIFIED', 'BREAK EDGE', 'ALL DIMENSIONS',
  ]
);
const LABEL_WORDS = new Set([...LABELS].flatMap((l) => l.split(' ')));
const isLabel = (t: string) => {
  const n = norm(t);
  if (/:\s*$/.test(t.trim()) || LABELS.has(n)) return true;
  // a run of header words ("PART NUMBER DASH SOURCE") is a header row, not a value
  const words = n.split(' ');
  return words.length > 1 && words.every((w) => LABEL_WORDS.has(w));
};

const first = <T>(pages: PageText[], fn: (p: PageText) => T | null): T | null => {
  for (const p of pages) {
    const v = fn(p);
    if (v !== null && v !== undefined) return v;
  }
  return null;
};

interface Found {
  value: string;
  seg: Seg;
}

/**
 * The value that belongs to a label: written on the same line right after it, else the nearest text below it
 * in the same cell. Another label next to it means the cell is empty to the right, so we look below instead.
 */
function valueOf(page: PageText, labelRe: RegExp, accept: (v: string) => boolean = () => true): Found | null {
  const segs = page.segs;
  for (const label of segs) {
    // "MATERIAL: EN8" written as one run
    const inline = label.text.match(/^([^:]{2,30}):\s*(.+)$/);
    if (inline && labelRe.test(norm(inline[1])) && accept(inline[2].trim())) return { value: inline[2].trim(), seg: label };

    if (!labelRe.test(norm(label.text.replace(/:\s*$/, '')))) continue;
    const end = label.x + label.w;

    const right = segs
      .filter((s) => s !== label && Math.abs(s.y - label.y) < Math.max(3, label.h * 0.5) && s.x >= end - 2 && s.x - end < 160)
      .sort((a, b) => a.x - b.x)[0];
    if (right && !isLabel(right.text) && accept(right.text)) return { value: right.text, seg: right };

    const below = segs
      .filter((s) => {
        const dy = s.y - label.y;
        return s !== label && dy > label.h * 0.5 && dy <= 32 && s.x >= label.x - 12 && s.x <= label.x + 200 && !isLabel(s.text);
      })
      .map((s) => ({ s, score: s.y - label.y + 1.5 * Math.max(0, s.x - label.x) }))
      .sort((a, b) => a.score - b.score)[0];
    if (below && accept(below.s.text)) return { value: below.s.text, seg: below.s };
  }
  return null;
}

// --- numbers and sizes ---------------------------------------------------------------------------

/** "2 1/2", "49-1/8", ".859", "3/16", "22" → a number. */
export function parseNum(s: string): number | null {
  const t = s.trim().replace(/\s*-\s*(?=\d+\/)/, ' ');
  let m = t.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (m) return +m[1] + +m[2] / +m[3];
  m = t.match(/^(\d+)\/(\d+)$/);
  if (m) return +m[1] / +m[2];
  return /^\d*\.?\d+$/.test(t) ? Number(t) : null;
}

const N = String.raw`(\d+(?:\s+|-)\d+\/\d+|\d*\.\d+|\d+\/\d+|\d+)`;
const U = String.raw`(["”]|''|IN\.?|MM)?`;
// "Ø26 X 84 LONG", "SHAFT OD 22 X 45 LONG", `2 1/2" DIA X 49 1/8" LG.` — a diameter by a length
const SIZE_RE = new RegExp(
  `${N}\\s*${U}\\s*(?:DIA\\.?|DIAMETER|OD|Ø|⌀)?\\s*[X×]\\s*${N}\\s*${U}\\s*(?:LG|LONG|LENGTH|LGTH)(?![A-Z])`,
  'i'
);

type Units = 'mm' | 'inch';
const toMm = (v: number, u: Units) => Number((u === 'inch' ? v * 25.4 : v).toFixed(2));

function sizeFrom(texts: string[], units: Units): { od: number; length: number; raw: string; unit: Units } | null {
  for (const text of texts) {
    const m = text.match(SIZE_RE);
    if (!m) continue;
    const od = parseNum(m[1]);
    const length = parseNum(m[3]);
    if (od === null || length === null || od <= 0 || length <= 0) continue;
    const mark = `${m[2] ?? ''}${m[4] ?? ''}`;
    const unit: Units = /["”']|IN/i.test(mark) ? 'inch' : /MM/i.test(mark) ? 'mm' : units;
    return { od, length, raw: m[0].trim(), unit };
  }
  return null;
}

function unitsOf(pages: PageText[]): Units | null {
  const all = pages.flatMap((p) => p.segs.map((s) => s.text)).join(' \n ');
  // "ALL DIMENSIONS" / "ARE IN mm." often sit on separate lines of the title block
  const own = pages
    .flatMap((p) => p.segs.map((s) => s.text))
    .map((t) => t.match(/^(?:ALL\s+)?(?:DIMENSIONS?\s+)?(?:ARE\s+)?IN\s*(MM|MILLIMET\w*|INCH\w*)\.?$/i))
    .find(Boolean);
  const said =
    own ??
    all.match(/\b(?:DIMENSIONS?|UNITS?)\b[^.\n]{0,25}?\b(?:ARE\s+)?IN\s*(MM|MILLIMET\w*|INCH\w*|IN)\b/i) ??
    all.match(/\bUNITS?\s*[:=]\s*(MM|MILLIMET\w*|INCH\w*|IN)\b/i);
  if (said) return /^(MM|MILLI)/i.test(said[1]) ? 'mm' : 'inch';
  const inchMarks = (all.match(/\d\s*["”]|\d-\d\/\d/g) ?? []).length;
  const mmMarks = (all.match(/\d\s*mm\b/gi) ?? []).length;
  if (inchMarks >= 3 && mmMarks === 0) return 'inch';
  return null;
}

// --- material grade ------------------------------------------------------------------------------

const GRADE_RE =
  /\b(?:SS\s?-?\d{3}[A-Z]{0,2}|\d{3}[A-Z]{0,2}\s?SS|EN\s?-?\d{1,2}[A-Z]?|SAE\s?\d{4}|AISI\s?\d{3,4}[A-Z]?|C\s?-?\d{2}(?!\d)|\d{2}CR(?:MO|NI)?\d*|\d{2}MNCR\d+|ASTM\s?A\s?-?\d{2,3}[A-Z]?|[AF]-?\d{3}[A-Z]?)\b/i;

// --- drawing number ------------------------------------------------------------------------------

const ID_RE = /^[A-Z0-9][A-Z0-9\-_/.]{2,30}$/i;
const looksLikeId = (v: string) => ID_RE.test(v.trim()) && /\d/.test(v);

function drawingNoGuess(pages: PageText[], hint?: string): string | null {
  const want = (hint ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const cands = pages
    .flatMap((p) => p.segs.filter((s) => s.x > p.width * 0.5 && s.y > p.height * 0.7).map((s) => ({ s, p })))
    .filter(({ s }) => /^[A-Z]{0,4}\d{4,}[A-Z0-9-]*$/i.test(s.text.trim()))
    .sort((a, b) => b.s.x + b.s.y - (a.s.x + a.s.y));
  if (want) {
    const hit = cands.find(({ s }) => s.text.toUpperCase().replace(/[^A-Z0-9]/g, '').endsWith(want.replace(/^[A-Z]+/, '')));
    if (hit) return hit.s.text.trim();
  }
  return cands[0]?.s.text.trim() ?? null;
}

// --- the part name when the title block has no "TITLE" label --------------------------------------

const NOT_A_NAME = new Set(
  [...LABELS].flatMap((l) => l.split(' ')).concat(
    ['CORP', 'USA', 'TEL', 'FAX', 'NJ', 'INC', 'LTD', 'PVT', 'BREAK', 'EDGE', 'EDGES', 'SHARP', 'SECTION', 'VIEW', 'SHEET', 'OF',
      'UNLESS', 'OTHERWISE', 'SPECIFIED', 'TOLERANCE', 'NOTE', 'RELEASE', 'INITIAL', 'CONFIDENTIAL', 'PROPRIETARY', 'DRAWING']
  )
);

function nameGuess(pages: PageText[]): string | null {
  const cands = pages
    .flatMap((p) => p.segs.filter((s) => s.x > p.width * 0.45 && s.y > p.height * 0.7))
    .filter((s) => /^[A-Z][A-Z &\-/]{3,40}$/.test(s.text.trim()))
    .filter((s) => !norm(s.text).split(' ').some((w) => NOT_A_NAME.has(w)))
    .sort((a, b) => b.h - a.h || b.x - a.x);
  return cands[0]?.text.trim() ?? null;
}

// --- the extraction ------------------------------------------------------------------------------

export function extractFromText(pages: PageText[], hint?: { partNumber?: string; revision?: string }): SpecExtractResult {
  const flags: string[] = [
    "Read from the PDF's text layer — no AI was used. Only the title-block fields and the stock size were captured; " +
      'dimensions, tolerances and notes were not read. Use the AI reading for the full dimension list.',
  ];

  // drawing number
  let drawingNo = first(pages, (p) => valueOf(p, /^(DRAWING|DWG|DRG) ?(NO|NUMBER|NUM)?$/, looksLikeId))?.value ?? null;
  if (!drawingNo) {
    drawingNo = drawingNoGuess(pages, hint?.partNumber);
    flags.push(
      drawingNo
        ? `Drawing number "${drawingNo}" was picked from the title-block corner — there is no "DRAWING NO." label; please confirm it`
        : 'No drawing number could be read'
    );
  }

  // item name (the printed title)
  let itemName =
    first(pages, (p) => valueOf(p, /^(TITLE|DRAWING TITLE|PART NAME|ITEM NAME|PART DESCRIPTION)$/, (v) => /[A-Z]{3}/i.test(v)))?.value ?? null;
  if (!itemName) {
    itemName = nameGuess(pages);
    flags.push(
      itemName
        ? `Item name "${itemName}" was picked from the title block by position (no "TITLE:" label) — please confirm it`
        : 'No item name could be read'
    );
  }

  // material
  const mat = first(pages, (p) => valueOf(p, /^(MATERIAL|MATERIAL GRADE|MATL|MATERIAL SPEC(?:IFICATION)?)$/, (v) => /[A-Z0-9]{2}/i.test(v)))?.value ?? null;
  let materialNote: string | null = mat;
  let materialGrade: string | null = null;
  if (mat && !isPlaceholderGrade(mat)) materialGrade = mat;
  else if (mat) flags.push(`Material is "${mat}" — the drawing names no grade; it comes from the BOM or the customer`);
  else {
    const g = pages.flatMap((p) => p.segs).find((s) => GRADE_RE.test(s.text) && !/\d\s*(?:MM|["”])/i.test(s.text));
    if (g) {
      materialGrade = g.text.match(GRADE_RE)![0].trim();
      materialNote = g.text.trim();
      flags.push(`Material grade "${materialGrade}" was found in the text but not under a MATERIAL label — please confirm it`);
    } else flags.push('No material or grade could be read');
  }

  // units and stock size
  const units = unitsOf(pages);
  const bom = first(pages, (p) => valueOf(p, /^DESCRIPTION$/))?.value;
  const size = sizeFrom([itemName ?? '', bom ?? '', ...pages.flatMap((p) => p.segs.map((s) => s.text))], units ?? 'mm');
  if (!units) flags.push('The drawing does not state its units — millimetres assumed');
  const unit: Units = units ?? size?.unit ?? 'mm';

  const items: SpecExtractResult['items'] = [];
  let maxOdMm: number | null = null;
  let overallLengthMm: number | null = null;
  if (size) {
    maxOdMm = toMm(size.od, size.unit);
    overallLengthMm = toMm(size.length, size.unit);
    const common = { unit: 'mm', tolUpper: null, tolLower: null, tolClass: null, datum: null, gdtType: null, rawText: size.raw, confidence: 0.5 };
    items.push(
      { itemType: 'DIAMETER', label: `Ø${maxOdMm}`, nominalValue: maxOdMm, ...common },
      { itemType: 'LENGTH', label: `${overallLengthMm} long`, nominalValue: overallLengthMm, ...common }
    );
    flags.push(
      `Size ${maxOdMm} × ${overallLengthMm} mm was taken from the printed text "${size.raw}"` +
        (size.unit === 'inch' ? ' and converted from inches' : '') +
        ' — it is not measured from the views'
    );
  } else flags.push('No "diameter × length" size was found in the title or description');

  // revision
  const rev = first(pages, (p) => valueOf(p, /^REV(ISION)?$/, (v) => /^(R\d{1,2}|[A-Z]\d?|[A-Z]{1,2})$/.test(v.trim())))?.value ?? null;

  return {
    header: {
      drawingNo,
      title: itemName,
      itemName,
      materialNote,
      materialGrade,
      units: unit,
      revision: rev ?? hint?.revision ?? null,
      maxOdMm,
      overallLengthMm,
      confidence: 0.4,
    },
    items,
    flags,
  };
}
