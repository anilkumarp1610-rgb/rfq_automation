import { Router, Response } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { authenticateToken, canEditRfq, AuthRequest } from '../middleware/auth.js';
import { ah, badRequest, notFound } from '../lib/http.js';
import { TEST_DRAWINGS_DIR, testDrawingUpload, RejectedFile } from '../lib/upload.js';
import { prisma } from '../lib/prisma.js';
import { analyzeDrawing, extractionMode } from '../spec-analysis/analyze.js';
import { deriveWeights } from '../spec-analysis/weights.js';
import { partNumberFromFilename } from '../spec-analysis/filenamePart.js';
import { isPlaceholderGrade, matchGrade } from '../spec-analysis/grade.js';

/**
 * Internal test folder — drop drawings here to see what the extraction reads from each one,
 * without creating customers, parts or RFQs. Nothing here touches the database except a
 * read of the grade master (to show which grade a drawing would pick).
 */
const router = Router();
router.use(authenticateToken, canEditRfq);

const ANALYSIS_DIR = path.join(TEST_DRAWINGS_DIR, '_analysis');
const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

/** A stored file name from the URL — rejected unless it is a plain name inside the folder. */
export function safeName(raw: string): string {
  const ok =
    raw === path.basename(raw) && /^[\w][\w.\- ]{0,200}$/.test(raw) && Object.keys(MIME).includes(path.extname(raw).toLowerCase());
  if (!ok) badRequest('Invalid file name');
  return raw;
}
const filePath = (name: string) => path.join(TEST_DRAWINGS_DIR, name);
const analysisPath = (name: string) => path.join(ANALYSIS_DIR, `${name}.json`);

interface StoredAnalysis {
  analyzedAt: string;
  mock: boolean;
  source: 'ai' | 'text' | 'sample';
  model: string | null;
  usage: { inputTokens: number; outputTokens: number } | null;
  seconds: number;
  filenamePart: string | null;
  header: Record<string, unknown>;
  items: unknown[];
  flags: string[];
  weights: unknown;
  gradeText: string | null;
  gradeMatch: { gradeCode: string; materialType: string } | null;
}

async function readAnalysis(name: string): Promise<StoredAnalysis | null> {
  try {
    return JSON.parse(await fs.readFile(analysisPath(name), 'utf8')) as StoredAnalysis;
  } catch {
    return null;
  }
}

/** The one-line summary the list and the comparison table show. */
function summary(a: StoredAnalysis | null) {
  if (!a) return null;
  const h = a.header as Record<string, string | number | null | undefined>;
  return {
    analyzedAt: a.analyzedAt,
    mock: a.mock,
    source: a.source ?? (a.mock ? 'sample' : 'ai'),
    model: a.model,
    usage: a.usage,
    seconds: a.seconds,
    drawingNo: h.drawingNo ?? null,
    itemName: h.itemName ?? h.title ?? null,
    materialGrade: h.materialGrade ?? null,
    materialNote: h.materialNote ?? null,
    gradeMatch: a.gradeMatch,
    units: h.units ?? null,
    productType: h.productType ?? null,
    customerName: h.customerName ?? null,
    revision: h.revision ?? null,
    maxOdMm: h.maxOdMm ?? null,
    overallLengthMm: h.overallLengthMm ?? null,
    itemCount: a.items.length,
    flagCount: a.flags.length,
  };
}

// --- list ------------------------------------------------------------------
router.get(
  '/',
  ah(async (_req: AuthRequest, res: Response) => {
    const names = (await fs.readdir(TEST_DRAWINGS_DIR, { withFileTypes: true }))
      .filter((d) => d.isFile() && MIME[path.extname(d.name).toLowerCase()])
      .map((d) => d.name);
    const rows = await Promise.all(
      names.map(async (name) => {
        const st = await fs.stat(filePath(name));
        return {
          name,
          size: st.size,
          uploadedAt: st.birthtime.toISOString(),
          mime: MIME[path.extname(name).toLowerCase()],
          analysis: summary(await readAnalysis(name)),
        };
      })
    );
    rows.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
    res.json({
      files: rows,
      // lets the page say up front whether a click will call the real model, a sample stub, or fail
      extraction: extractionMode(),
    });
  })
);

// --- upload (several at once) ----------------------------------------------
router.post(
  '/',
  testDrawingUpload.array('files', 50),
  ah(async (req: AuthRequest, res: Response) => {
    const saved = ((req.files as Express.Multer.File[]) ?? []).map((f) => f.filename);
    const rejected = ((req as unknown as { rejected?: RejectedFile[] }).rejected ?? []) as RejectedFile[];
    if (!saved.length && !rejected.length) badRequest('Choose one or more PDF or image files (field name "files")');
    res.status(saved.length ? 201 : 422).json({ saved, rejected });
  })
);

// --- view / download --------------------------------------------------------
router.get(
  '/:name/file',
  ah(async (req: AuthRequest, res: Response) => {
    const name = safeName(req.params.name);
    try {
      await fs.access(filePath(name));
    } catch {
      notFound('Drawing');
    }
    res.type(MIME[path.extname(name).toLowerCase()]).sendFile(filePath(name));
  })
);

// --- analyze one file -------------------------------------------------------
router.post(
  '/:name/analyze',
  ah(async (req: AuthRequest, res: Response) => {
    const name = safeName(req.params.name);
    let buffer: Buffer;
    try {
      buffer = await fs.readFile(filePath(name));
    } catch {
      return notFound('Drawing');
    }
    const filenamePart = partNumberFromFilename(name);

    const started = Date.now();
    // ?mode=text reads only the PDF's own text — free, no AI call
    const result = await analyzeDrawing(
      buffer,
      MIME[path.extname(name).toLowerCase()],
      { partNumber: filenamePart ?? undefined },
      { textOnly: req.query.mode === 'text' }
    );
    const seconds = Number(((Date.now() - started) / 1000).toFixed(1));

    const gradeText = (result.header.materialGrade ?? result.header.materialNote ?? '').trim() || null;
    const grades = isPlaceholderGrade(gradeText)
      ? []
      : await prisma.materialCategory.findMany({ where: { isActive: true }, include: { materialType: true } });
    const hit = matchGrade(gradeText, grades);

    const stored: StoredAnalysis = {
      analyzedAt: new Date().toISOString(),
      mock: result.mock,
      source: result.source,
      model: result.model ?? null,
      usage: result.usage ?? null,
      seconds,
      filenamePart,
      header: result.header as Record<string, unknown>,
      items: result.items,
      flags: result.flags,
      weights: deriveWeights(result, 7850),
      gradeText,
      gradeMatch: hit ? { gradeCode: hit.gradeCode, materialType: hit.materialType.name } : null,
    };
    await fs.mkdir(ANALYSIS_DIR, { recursive: true });
    await fs.writeFile(analysisPath(name), JSON.stringify(stored, null, 2));
    res.json({ name, ...stored });
  })
);

// --- the full stored result of a previous analysis --------------------------
router.get(
  '/:name/analysis',
  ah(async (req: AuthRequest, res: Response) => {
    const name = safeName(req.params.name);
    const a = await readAnalysis(name);
    if (!a) notFound('Analysis');
    res.json({ name, ...a });
  })
);

// --- delete -----------------------------------------------------------------
router.delete(
  '/:name',
  ah(async (req: AuthRequest, res: Response) => {
    const name = safeName(req.params.name);
    try {
      await fs.unlink(filePath(name));
    } catch {
      return notFound('Drawing');
    }
    await fs.unlink(analysisPath(name)).catch(() => {});
    res.status(204).end();
  })
);

export default router;
