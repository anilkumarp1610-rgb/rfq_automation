import { Router, Response } from 'express';
import fs from 'node:fs/promises';
import { rfqFromSpecSchema } from '@rfq/shared';
import { prisma } from '../lib/prisma.js';
import { authenticateToken, canEditRfq, userId, AuthRequest } from '../middleware/auth.js';
import { ah, badRequest } from '../lib/http.js';
import { drawingUpload } from '../lib/upload.js';
import { audit } from '../lib/audit.js';
import { withRfqNumber } from '../lib/rfqNumber.js';
import { loadRfqVersionFull } from '../lib/rfqInclude.js';
import { analyzeDrawing, aiConfigured } from '../spec-analysis/analyze.js';
import { partNumberFromFilename } from '../spec-analysis/filenamePart.js';
import { deriveWeights } from '../spec-analysis/weights.js';
import { persistSpec } from '../spec-analysis/persist.js';
import { suggestProcessLines } from '../spec-analysis/suggestLines.js';
import { runCompute } from '../cost-engine/run.js';

const router = Router();
router.use(authenticateToken);

const GRADE_PLACEHOLDER = /as per|bom|standard|tbd|n\/?a|refer/i;
const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// --- 1. Preview: analyze the drawing, resolve lookups, create nothing ------
router.post(
  '/spec-preview',
  canEditRfq,
  drawingUpload.single('file'),
  ah(async (req: AuthRequest, res: Response) => {
    if (!req.file) badRequest('Upload a spec PDF or image (field name "file")');

    const filenamePart = partNumberFromFilename(req.file!.originalname);
    const buffer = await fs.readFile(req.file!.path);
    const extract = await analyzeDrawing(buffer, req.file!.mimetype, {
      partNumber: filenamePart ?? undefined,
    });
    // the preview file is not needed again — the client re-sends it to /from-spec
    await fs.unlink(req.file!.path).catch(() => {});

    const partNumber = (extract.header.drawingNo || filenamePart || '').trim() || null;
    const weights = deriveWeights(extract, 7850);

    const existingPart = partNumber
      ? await prisma.customerPart.findFirst({
          where: { customerPartNumber: partNumber },
          include: {
            rfqs: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              include: { versions: { orderBy: { revisionNo: 'desc' }, take: 1 } },
            },
          },
        })
      : null;
    const latestRfq = existingPart?.rfqs[0] ?? null;

    const customerName = extract.header.customerName?.trim() || null;
    const customerMatch = customerName
      ? await prisma.customer.findFirst({
          where: {
            isActive: true,
            OR: [{ code: { equals: customerName } }, { name: { contains: customerName } }],
          },
        })
      : null;

    const materialNote = extract.header.materialNote?.trim() || null;
    const gradeReal = materialNote && !GRADE_PLACEHOLDER.test(materialNote);
    const gradeMatch = gradeReal
      ? await prisma.materialCategory.findFirst({
          where: { isActive: true, gradeCode: { equals: materialNote! } },
          include: { materialType: true },
        })
      : null;

    const roundBar = await prisma.materialShape.findFirst({
      where: { isActive: true, name: { contains: 'Round' } },
    });

    res.json({
      partNumber,
      partName: extract.header.title?.trim() || null,
      revision: extract.header.revision?.trim() || 'R00',
      productType: extract.header.productType?.trim() || null,
      materialNote,
      header: extract.header,
      items: extract.items,
      weights,
      flags: extract.flags,
      mock: extract.mock,
      aiConfigured: aiConfigured(),
      extract, // opaque — passed straight back to /from-spec
      existing: latestRfq
        ? {
            customerPartId: existingPart!.id.toString(),
            rfqId: latestRfq.id.toString(),
            rfqNumber: latestRfq.rfqNumber,
            latestRevisionNo: latestRfq.versions[0]?.revisionNo ?? 1,
          }
        : null,
      customerMatch: customerMatch
        ? {
            id: customerMatch.id.toString(),
            code: customerMatch.code,
            name: customerMatch.name,
            rating: customerMatch.rating,
          }
        : null,
      suggestedCustomerName: customerName,
      gradeMatch: gradeMatch
        ? {
            id: gradeMatch.id.toString(),
            gradeCode: gradeMatch.gradeCode,
            materialType: gradeMatch.materialType.name,
          }
        : null,
      suggestedShape: roundBar ? { id: roundBar.id.toString(), name: roundBar.name } : null,
    });
  })
);

// --- 2. Create: customer/part/RFQ (or revision) + spec + draft cost -------
router.post(
  '/from-spec',
  canEditRfq,
  drawingUpload.single('file'),
  ah(async (req: AuthRequest, res: Response) => {
    if (!req.file) badRequest('Re-send the spec file with the confirmed details');
    let b: import('@rfq/shared').RfqFromSpecInput;
    try {
      b = rfqFromSpecSchema.parse(JSON.parse(req.body.payload ?? '{}'));
    } catch (e) {
      return res.status(422).json({ error: 'Invalid payload', detail: (e as Error).message });
    }
    const uid = userId(req);
    const now = new Date();

    // --- customer -------------------------------------------------------
    let customerId = b.customerId ? BigInt(b.customerId) : null;
    let createdCustomer = false;
    if (!customerId && b.newCustomerName) {
      const code =
        b.newCustomerName.replace(/[^A-Za-z0-9]/g, '').slice(0, 12).toUpperCase() ||
        `CUST${Date.now().toString().slice(-6)}`;
      const c = await prisma.customer.create({ data: { code, name: b.newCustomerName, rating: 3 } });
      customerId = c.id;
      createdCustomer = true;
      await audit(req, { entityType: 'Customer', entityId: c.id, action: 'CREATE', changes: { via: 'spec-wizard' } });
    }
    if (!customerId) badRequest('Select an existing customer or provide a new customer name');

    // --- customer part -------------------------------------------------
    let part = await prisma.customerPart.findFirst({ where: { customerPartNumber: b.partNumber } });
    let createdPart = false;
    if (!part) {
      part = await prisma.customerPart.create({
        data: {
          customerId,
          customerPartNumber: b.partNumber,
          partName: b.partName,
          productTypeId: b.productTypeId ? BigInt(b.productTypeId) : null,
          drawingNo: b.extract.header.drawingNo ?? b.partNumber,
          currentRevision: b.revision,
        },
      });
      createdPart = true;
      await audit(req, { entityType: 'CustomerPart', entityId: part.id, action: 'CREATE', changes: { via: 'spec-wizard' } });
    }

    // --- RFQ / revision ------------------------------------------------
    const latestRfq = await prisma.rfq.findFirst({
      where: { customerPartId: part.id },
      orderBy: { createdAt: 'desc' },
    });

    if (latestRfq && !b.confirmRevision) {
      return res.status(409).json({
        error: 'This part already has an RFQ — confirm to add a new revision',
        needsRevisionConfirm: true,
        rfqId: latestRfq.id.toString(),
        rfqNumber: latestRfq.rfqNumber,
      });
    }

    let rfqId: bigint;
    let rfqNumber: string;
    let versionId: bigint;
    let revisionNo: number;
    const isNewRevision = !!latestRfq;

    if (latestRfq) {
      rfqId = latestRfq.id;
      rfqNumber = latestRfq.rfqNumber;
      const last = await prisma.rfqVersion.findFirst({
        where: { rfqId },
        orderBy: { revisionNo: 'desc' },
      });
      revisionNo = (last?.revisionNo ?? 0) + 1;
      const src = last
        ? await prisma.rfqPartAttributes.findUnique({ where: { rfqVersionId: last.id } })
        : null;
      const copied: Record<string, unknown> = {};
      if (src) {
        for (const [k, v] of Object.entries(src)) {
          if (k !== 'id' && k !== 'rfqVersionId') copied[k] = v;
        }
      }
      const version = await prisma.$transaction(async (tx) => {
        await tx.rfqVersion.updateMany({ where: { rfqId }, data: { isCurrent: false } });
        return tx.rfqVersion.create({
          data: {
            rfqId,
            revisionNo,
            versionLabel: b.versionLabel ?? null,
            basedOnPartRevision: b.revision,
            status: 'DRAFT',
            isCurrent: true,
            createdBy: uid,
            partAttributes: { create: copied },
          },
        });
      });
      versionId = version.id;
    } else {
      const created = await withRfqNumber((n) =>
        prisma.$transaction(async (tx) => {
          const rfq = await tx.rfq.create({
            data: {
              rfqNumber: n,
              customerPartId: part!.id,
              rfqDate: now,
              currency: b.currency,
              status: 'DRAFT',
              createdBy: uid,
            },
          });
          const v = await tx.rfqVersion.create({
            data: {
              rfqId: rfq.id,
              revisionNo: 1,
              versionLabel: b.versionLabel ?? null,
              basedOnPartRevision: b.revision,
              status: 'DRAFT',
              isCurrent: true,
              createdBy: uid,
              partAttributes: { create: {} },
            },
          });
          return { rfq, v };
        })
      );
      rfqId = created.rfq.id;
      rfqNumber = created.rfq.rfqNumber;
      versionId = created.v.id;
      revisionNo = 1;
    }

    // --- attachment ---------------------------------------------------
    const attachment = await prisma.rfqAttachment.create({
      data: {
        rfqVersionId: versionId,
        fileName: req.file!.originalname,
        path: req.file!.path,
        mime: req.file!.mimetype,
      },
    });

    // --- resolve material + derive weights --------------------------
    const catId = b.materialCategoryId ? BigInt(b.materialCategoryId) : null;
    const shapeId = b.materialShapeId ? BigInt(b.materialShapeId) : null;
    let density = 7850;
    if (catId) {
      const cat = await prisma.materialCategory.findUnique({ where: { id: catId } });
      if (cat?.densityKgM3) density = Number(cat.densityKgM3);
    }
    const weights = deriveWeights(b.extract, density);
    const iw = num(weights.estInputWeightKg) ?? num(weights.estNetWeightKg) ?? 0;
    const boughtOut = b.sourcingType === 'BOUGHT_OUT';

    // --- part attributes -------------------------------------------
    const surfaceFinish =
      b.extract.items.find((i) => i.itemType === 'SURFACE_FINISH')?.label ??
      b.extract.items.find((i) => i.itemType === 'SURFACE_FINISH')?.rawText ??
      null;
    const materialNote = b.extract.header.materialNote?.trim() || null;
    const attrData: Record<string, unknown> = {
      sourcingType: b.sourcingType,
      purchasePricePerPc: boughtOut ? (b.purchasePricePerPc ?? null) : null,
      supplierName: boughtOut ? (b.supplierName ?? null) : null,
      materialCategoryId: boughtOut ? null : catId,
      materialShapeId: boughtOut ? null : shapeId,
      productTypeId: b.productTypeId ? BigInt(b.productTypeId) : (part.productTypeId ?? null),
      netWeightKg: weights.estNetWeightKg,
      forgiveLossPct: boughtOut ? null : b.forgingLossPct,
      surfaceFinish,
      dimensions: JSON.stringify({
        maxOdMm: b.extract.header.maxOdMm ?? null,
        overallLengthMm: b.extract.header.overallLengthMm ?? null,
        acrossFlatsMm: b.extract.header.acrossFlatsMm ?? null,
      }),
      features: materialNote ? JSON.stringify({ specMaterialNote: materialNote }) : null,
      reviewed: false,
    };
    await prisma.rfqPartAttributes.upsert({
      where: { rfqVersionId: versionId },
      create: { rfqVersionId: versionId, ...attrData },
      update: attrData,
    });

    // --- persist the spec analysis (by part + revision) -----------
    const spec = await persistSpec({
      customerPartId: part.id,
      rfqVersionId: versionId,
      attachmentId: attachment.id,
      revision: b.revision,
      extract: b.extract,
      weights,
      createdBy: uid,
      mock: b.mock,
    });
    await audit(req, {
      entityType: 'SpecAnalysis',
      entityId: spec!.id,
      action: 'ANALYZE',
      changes: { via: 'spec-wizard', revision: b.revision, items: b.extract.items.length },
    });

    // --- suggested cost lines -------------------------------------
    const flags: string[] = [...(b.extract.flags ?? [])];
    if (boughtOut && !(b.purchasePricePerPc && b.purchasePricePerPc > 0)) {
      flags.push('Bought-out part — enter the purchase price on the RFQ before quoting.');
    }
    if (b.autoLines && !boughtOut) {
      const s = await suggestProcessLines(b.extract, iw);
      flags.push(...s.flags);
      if (s.processes.length) {
        await prisma.$transaction(async (tx) => {
          for (const l of s.processes) {
            await tx.rfqProcess.create({
              data: {
                rfqVersionId: versionId,
                processId: BigInt(l.processId),
                machineId: l.machineId ? BigInt(l.machineId) : null,
                method: l.method,
                quantityOrTime: l.quantityOrTime,
                rate: l.rate,
                cost: 0,
                sequence: l.sequence,
              },
            });
          }
        });
      }

      if (catId && shapeId && iw > 0) {
        const sc = await prisma.materialSizeConfig.findFirst({
          where: { isActive: true, materialCategoryId: catId, materialShapeId: shapeId },
        });
        const price = sc
          ? await prisma.materialPrice.findFirst({
              where: {
                isActive: true,
                materialSizeConfigId: sc.id,
                effectiveFrom: { lte: now },
                OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
              },
              orderBy: { effectiveFrom: 'desc' },
            })
          : null;
        if (sc && price) {
          const rate = Number(price.ratePerKg);
          await prisma.rfqMaterial.deleteMany({ where: { rfqVersionId: versionId } });
          await prisma.rfqMaterial.create({
            data: {
              rfqVersionId: versionId,
              materialSizeConfigId: sc.id,
              inputWeightKg: iw,
              ratePerKg: rate,
              wastagePct: 0,
              materialCost: iw * rate,
            },
          });
        } else {
          flags.push(
            'No effective material price for the chosen grade/shape — set the material line on the cost sheet.'
          );
        }
      } else if (!catId) {
        flags.push('Material grade not set — pick one on the RFQ before quoting.');
      }
    }

    // --- RFQ header qty ------------------------------------------
    await prisma.rfq.update({
      where: { id: rfqId },
      data: {
        ...(b.annualQty != null ? { annualQty: b.annualQty } : {}),
        ...(b.batchQty != null ? { batchQty: b.batchQty } : {}),
        ...(b.requiredDate ? { requiredDate: b.requiredDate } : {}),
        currency: b.currency,
      },
    });

    // --- best-effort compute -----------------------------------
    let costSummary = null;
    const run = await runCompute(versionId, {
      quantity: b.annualQty != null ? Number(b.annualQty) : undefined,
      persist: true,
    });
    if (run) {
      costSummary = run.summary;
      flags.push(...run.warnings);
    }

    await audit(req, {
      entityType: 'Rfq',
      entityId: rfqId,
      action: isNewRevision ? 'UPDATE' : 'CREATE',
      changes: { via: 'spec-wizard', partNumber: b.partNumber, isNewRevision, revisionNo },
    });

    res.status(201).json({
      rfqId: rfqId.toString(),
      rfqNumber,
      versionId: versionId.toString(),
      revisionNo,
      isNewRevision,
      createdCustomer,
      createdPart,
      spec,
      weights,
      costSummary,
      flags: [...new Set(flags)],
      version: await loadRfqVersionFull(versionId),
    });
  })
);

export default router;
