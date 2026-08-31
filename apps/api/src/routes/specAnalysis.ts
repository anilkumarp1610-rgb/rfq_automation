import { Router, Response } from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import multer from 'multer';
import { specReviewSchema, specApplySchema } from '@rfq/shared';
import { prisma } from '../lib/prisma.js';
import { authenticateToken, canEditRfq, userId, AuthRequest } from '../middleware/auth.js';
import { validateBody } from '../lib/validate.js';
import { ah, bigIntParam, notFound, badRequest } from '../lib/http.js';
import { analyzeDrawing, aiConfigured } from '../spec-analysis/analyze.js';
import { deriveWeights } from '../spec-analysis/weights.js';
import { persistSpec } from '../spec-analysis/persist.js';
import { audit } from '../lib/audit.js';

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) =>
      cb(null, `${Date.now()}-${file.originalname.replace(/[^\w.\-]+/g, '_')}`),
  }),
  limits: { fileSize: 32 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif'];
    cb(null, ok.includes(file.mimetype));
  },
});

const router = Router();
router.use(authenticateToken);

async function loadVersionCtx(id: bigint) {
  const version = await prisma.rfqVersion.findUnique({
    where: { id },
    include: {
      rfq: { include: { customerPart: true } },
      partAttributes: true,
      attachments: { orderBy: { uploadedAt: 'desc' } },
    },
  });
  if (!version) notFound('RFQ version');
  const part = version!.rfq.customerPart;
  const revision =
    version!.basedOnPartRevision?.trim() || part.currentRevision?.trim() || 'R00';
  return { version: version!, part, revision };
}

// --- Upload a drawing --------------------------------------------------------
router.post(
  '/:id/attachments',
  canEditRfq,
  upload.single('file'),
  ah(async (req: AuthRequest, res: Response) => {
    const id = bigIntParam(req.params.id);
    if (!req.file) badRequest('No file uploaded (field name must be "file", PDF or image)');
    const version = await prisma.rfqVersion.findUnique({ where: { id } });
    if (!version) notFound('RFQ version');

    const attachment = await prisma.rfqAttachment.create({
      data: {
        rfqVersionId: id,
        fileName: req.file!.originalname,
        path: req.file!.path,
        mime: req.file!.mimetype,
      },
    });
    res.status(201).json(attachment);
  })
);

router.get(
  '/:id/attachments',
  ah(async (req: AuthRequest, res: Response) => {
    const rows = await prisma.rfqAttachment.findMany({
      where: { rfqVersionId: bigIntParam(req.params.id) },
      orderBy: { uploadedAt: 'desc' },
    });
    res.json(rows);
  })
);

// --- Analyze: PDF → structured spec data → save by part number ------------
router.post(
  '/:id/analyze-spec',
  canEditRfq,
  ah(async (req: AuthRequest, res: Response) => {
    const id = bigIntParam(req.params.id);
    const { version, part, revision } = await loadVersionCtx(id);

    const attachmentId = req.body?.attachmentId ? BigInt(req.body.attachmentId) : null;
    const attachment = attachmentId
      ? version.attachments.find((a) => a.id === attachmentId)
      : version.attachments[0];
    if (!attachment) badRequest('Upload a drawing first (POST /rfq-versions/:id/attachments)');

    let buffer: Buffer;
    try {
      buffer = await fs.readFile(attachment!.path);
    } catch {
      badRequest('Uploaded file is missing on disk — re-upload the drawing', 410);
    }

    const extract = await analyzeDrawing(buffer!, attachment!.mime, {
      partNumber: part.customerPartNumber,
      revision,
    });

    // density for weight derivation
    let density = 7850;
    if (version.partAttributes?.materialCategoryId) {
      const cat = await prisma.materialCategory.findUnique({
        where: { id: version.partAttributes.materialCategoryId },
      });
      if (cat?.densityKgM3) density = Number(cat.densityKgM3);
    }
    const weights = deriveWeights(extract, density);

    const spec = await persistSpec({
      customerPartId: part.id,
      rfqVersionId: id,
      attachmentId: attachment!.id,
      revision,
      extract,
      weights,
      createdBy: userId(req),
      mock: extract.mock,
    });

    await audit(req, {
      entityType: 'SpecAnalysis',
      entityId: spec!.id,
      action: 'ANALYZE',
      changes: { revision, itemCount: extract.items.length, mock: extract.mock, weights },
    });
    res.status(201).json({ spec, weights, flags: extract.flags, mock: extract.mock, aiConfigured: aiConfigured() });
  })
);

// --- Get / review the saved spec for this version's part+revision --------
router.get(
  '/:id/spec',
  ah(async (req: AuthRequest, res: Response) => {
    const { part, revision } = await loadVersionCtx(bigIntParam(req.params.id));
    const spec = await prisma.specAnalysis.findUnique({
      where: { customerPartId_revision: { customerPartId: part.id, revision } },
      include: { items: { orderBy: { id: 'asc' } }, attachment: true },
    });
    if (!spec) return res.status(404).json({ error: 'No spec analysis yet for this part revision' });
    res.json(spec);
  })
);

router.put(
  '/:id/spec',
  canEditRfq,
  validateBody(specReviewSchema),
  ah(async (req: AuthRequest, res: Response) => {
    const { part, revision } = await loadVersionCtx(bigIntParam(req.params.id));
    const b = req.body as import('@rfq/shared').SpecReviewInput;

    const spec = await prisma.specAnalysis.findUnique({
      where: { customerPartId_revision: { customerPartId: part.id, revision } },
    });
    if (!spec) notFound('Spec analysis');

    const h = b.header ?? {};
    await prisma.$transaction(async (tx) => {
      await tx.specAnalysis.update({
        where: { id: spec!.id },
        data: {
          ...pick(h, [
            'drawingNo',
            'title',
            'customerName',
            'coNo',
            'sheetSize',
            'scale',
            'materialNote',
            'designedBy',
            'detailedBy',
            'checkedBy',
            'productType',
            'sectionView',
          ]),
          ...(h.overallLengthMm !== undefined ? { overallLengthMm: h.overallLengthMm ?? null } : {}),
          ...(h.maxOdMm !== undefined ? { maxOdMm: h.maxOdMm ?? null } : {}),
          ...(h.acrossFlatsMm !== undefined ? { acrossFlatsMm: h.acrossFlatsMm ?? null } : {}),
          ...(b.notes !== undefined ? { notes: b.notes ?? null } : {}),
          ...(b.estNetWeightKg !== undefined ? { estNetWeightKg: b.estNetWeightKg ?? null } : {}),
          ...(b.estInputWeightKg !== undefined ? { estInputWeightKg: b.estInputWeightKg ?? null } : {}),
          ...(b.reviewed !== undefined ? { reviewed: b.reviewed } : {}),
        },
      });

      for (const item of b.items ?? []) {
        if (item.id && item.remove) {
          await tx.specAnalysisItem.deleteMany({
            where: { id: BigInt(item.id), specAnalysisId: spec!.id },
          });
          continue;
        }
        const data = {
          itemType: item.itemType,
          label: item.label ?? null,
          nominalValue: item.nominalValue ?? null,
          unit: item.unit ?? null,
          tolUpper: item.tolUpper ?? null,
          tolLower: item.tolLower ?? null,
          tolClass: item.tolClass ?? null,
          datum: item.datum ?? null,
          gdtType: item.gdtType ?? null,
          rawText: item.rawText ?? null,
          confidence: item.confidence ?? null,
          reviewed: item.reviewed ?? true,
        };
        if (item.id) {
          await tx.specAnalysisItem.updateMany({
            where: { id: BigInt(item.id), specAnalysisId: spec!.id },
            data,
          });
        } else {
          await tx.specAnalysisItem.create({ data: { specAnalysisId: spec!.id, ...data } });
        }
      }
    });

    await audit(req, {
      entityType: 'SpecAnalysis',
      entityId: spec!.id,
      action: 'REVIEW',
      changes: { reviewed: b.reviewed, itemEdits: (b.items ?? []).length },
    });

    res.json(
      await prisma.specAnalysis.findUnique({
        where: { id: spec!.id },
        include: { items: { orderBy: { id: 'asc' } }, attachment: true },
      })
    );
  })
);

// --- Apply derived spec data onto the version's part attributes ---------
router.post(
  '/:id/spec/apply',
  canEditRfq,
  validateBody(specApplySchema),
  ah(async (req: AuthRequest, res: Response) => {
    const id = bigIntParam(req.params.id);
    const { part, revision } = await loadVersionCtx(id);
    const opts = req.body as import('@rfq/shared').SpecApplyInput;

    const spec = await prisma.specAnalysis.findUnique({
      where: { customerPartId_revision: { customerPartId: part.id, revision } },
    });
    if (!spec) notFound('Spec analysis');

    const data: Record<string, unknown> = {};
    if (opts.netWeightKg && spec.estNetWeightKg != null) {
      data.netWeightKg = Number(spec.estNetWeightKg);
    }
    if (opts.productType && spec.productType) {
      const pt = await prisma.productType.findFirst({
        where: { name: { equals: spec.productType }, isActive: true },
      });
      if (pt) data.productTypeId = pt.id;
    }
    if (opts.materialNote && spec.materialNote) {
      const feat = { specMaterialNote: spec.materialNote };
      data.features = JSON.stringify(feat);
    }

    const attrs = await prisma.rfqPartAttributes.upsert({
      where: { rfqVersionId: id },
      create: { rfqVersionId: id, ...data },
      update: data,
    });

    res.json({ applied: Object.keys(data), partAttributes: attrs });
  })
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pick<T extends Record<string, any>>(obj: T, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k in obj && obj[k] !== undefined) out[k] = obj[k] ?? null;
  return out;
}

export default router;
