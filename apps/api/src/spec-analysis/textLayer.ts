import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

/** A run of text on the page, in the orientation the drawing is viewed in (y grows downwards). */
export interface Seg {
  text: string;
  x: number;
  /** baseline */
  y: number;
  w: number;
  /** font size — the title block prints the part name larger than its labels */
  h: number;
}

export interface PageText {
  width: number;
  height: number;
  segs: Seg[];
}

/** Drawings sometimes hold many sheets; the title block we need is on the first ones. */
const MAX_PAGES = 3;

const fail = (message: string, status = 422) => Object.assign(new Error(message), { status, expose: true });

/**
 * Read the text layer of a PDF with positions. This is what makes the free, no-AI reading possible:
 * a drawing exported from CAD keeps its title block, BOM and notes as real text.
 * A scanned drawing has none — that is reported plainly, never guessed at.
 */
export async function readPdfText(buffer: Buffer): Promise<PageText[]> {
  let doc;
  try {
    doc = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      isEvalSupported: false,
      verbosity: 0,
    }).promise;
  } catch {
    throw fail('This PDF could not be opened — it may be damaged or password-protected');
  }

  const pages: PageText[] = [];
  try {
    for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGES); n++) {
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: 1 }); // already applies the page's /Rotate
      const content = await page.getTextContent();
      const raw: Seg[] = [];
      for (const it of content.items) {
        if (!('str' in it) || !it.str.trim()) continue;
        const t = pdfjs.Util.transform(vp.transform, it.transform);
        raw.push({ text: it.str.replace(/\s+/g, ' ').trim(), x: t[4], y: t[5], w: it.width, h: Math.hypot(t[2], t[3]) });
      }
      pages.push({ width: vp.width, height: vp.height, segs: joinRuns(raw) });
    }
  } finally {
    await doc.destroy();
  }

  if (pages.reduce((n, p) => n + p.segs.reduce((m, s) => m + s.text.length, 0), 0) < 20) {
    throw fail(
      'This PDF has no selectable text (it is a scan or an image of a drawing), so it cannot be read without AI — ' +
        'add Anthropic credit, or upload the PDF exported from CAD'
    );
  }
  return pages;
}

/**
 * CAD exporters often split one phrase into several text items ("AS PER" + "BOM"). Join items that sit on
 * the same line with only a word space between them; a bigger gap is a separate table cell (header cells such as "PART NUMBER" and "DASH" must not merge) and stays apart.
 */
export function joinRuns(items: Seg[]): Seg[] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const out: Seg[] = [];
  for (const s of sorted) {
    const prev = out[out.length - 1];
    const gap = prev ? s.x - (prev.x + prev.w) : Infinity;
    const sameLine = prev && Math.abs(prev.y - s.y) < Math.max(1.5, prev.h * 0.25);
    if (prev && sameLine && gap > -prev.h * 0.3 && gap < prev.h * 0.45 && Math.abs(prev.h - s.h) < prev.h * 0.35) {
      prev.text = `${prev.text}${gap > prev.h * 0.15 ? ' ' : ''}${s.text}`;
      prev.w = s.x + s.w - prev.x;
    } else out.push({ ...s });
  }
  return out;
}
