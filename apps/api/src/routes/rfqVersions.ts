import { Router, Response } from 'express';
import {
  rfqVersionUpdateSchema,
  rfqProcessesSchema,
  rfqMaterialSchema,
  computeRequestSchema,
  rfqReferenceSchema,
} from '@rfq/shared';
import { prisma } from '../lib/prisma.js';
import { authenticateToken, canEditRfq, AuthRequest } from '../middleware/auth.js';
import { validateBody } from '../lib/validate.js';
import { ah, bigIntParam, notFound } from '../lib/http.js';
import { toPartAttributesData } from '../lib/rfqAttributes.js';
import { resolveEngineInput } from '../cost-engine/resolve.js';
import { computeCost } from '../cost-engine/engine.js';
import { CostSummary } from '../cost-engine/types.js';
import { buildReference, REFERENCEABLE } from '../reference/build.js';
import { costSheetViewModel } from '../reports/costSheet.js';
import { audit } from '../lib/audit.js';

const router = Router();
router.use(authenticateToken);

const fullInclude = {
  rfq: { include: { customerPart: { include: { customer: true, productType: true } } } },
  partAttributes: true,
  materials: { include: { materialSizeConfig: { include: { materialCategory: true, materialShape: true } } } },
  processes: { include: { process: true, machine: true }, orderBy: { sequence: 'asc' } },
  costSummary: true,
  attachments: true,
  reference: true,
} as const;

const loadFull = (id: bigint) => prisma.rfqVersion.findUnique({ where: { id }, include: fullInclude });

function summaryToRow(s: CostSummary) {
  return {
    materialCost: s.materialCost,
    handlingCost: s.handlingCost,
    machiningCost: s.machiningCost,
    manualCost: s.manualCost,
    subcontractCost: s.subcontractCost,
    qcCost: s.qcCost,
    mfgCost: s.mfgCost,
    adminCost: s.adminCost,
    subtotal: s.subtotal,
    marginPct: s.marginPct,
    marginAmount: s.marginAmount,
    quotedPricePerPc: s.quotedPricePerPc,
    totalQuote: s.totalQuote,
    aiRecommendedMarginPct: s.aiRecommendedMarginPct,
    computedAt: new Date(),
  };
}

router.get(
  '/:id',
  ah(async (req: AuthRequest, res: Response) => {
    const version = await prisma.rfqVersion.findUnique({
      where: { id: bigIntParam(req.params.id) },
      include: fullInclude,
    });
    if (!version) notFound('RFQ version');
    res.json(version);
  })
);

router.put(
  '/:id',
  canEditRfq,
  validateBody(rfqVersionUpdateSchema),
  ah(async (req: AuthRequest, res: Response) => {
    const id = bigIntParam(req.params.id);
    const b = req.body as import('@rfq/shared').RfqVersionUpdateInput;

    const existing = await prisma.rfqVersion.findUnique({ where: { id } });
    if (!existing) notFound('RFQ version');

    await prisma.$transaction(async (tx) => {
      await tx.rfqVersion.update({
        where: { id },
        data: {
          ...(b.versionLabel !== undefined ? { versionLabel: b.versionLabel ?? null } : {}),
          ...(b.basedOnPartRevision !== undefined
            ? { basedOnPartRevision: b.basedOnPartRevision ?? null }
            : {}),
          ...(b.status ? { status: b.status } : {}),
        },
      });

      if (b.makeCurrent) {
        await tx.rfqVersion.updateMany({
          where: { rfqId: existing!.rfqId, id: { not: id } },
          data: { isCurrent: false },
        });
        await tx.rfqVersion.update({ where: { id }, data: { isCurrent: true } });
      }

      if (b.partAttributes) {
        const data = toPartAttributesData(b.partAttributes);
        await tx.rfqPartAttributes.upsert({
          where: { rfqVersionId: id },
          create: { rfqVersionId: id, ...data },
          update: data,
        });
      }
    });

    // Reaching a quoted / won / lost state records the version as reference history.
    if (b.status && REFERENCEABLE.has(b.status)) {
      await buildReference(id, { outcome: b.status });
    }

    await audit(req, {
      entityType: 'RfqVersion',
      entityId: id,
      action: 'UPDATE',
      changes: {
        status: b.status,
        makeCurrent: b.makeCurrent,
        partAttributes: b.partAttributes ? Object.keys(b.partAttributes) : undefined,
      },
    });

    const version = await loadFull(id);
    res.json(version);
  })
);

// --- History: (re)build this version's reference row -------------------
router.post(
  '/:id/reference',
  canEditRfq,
  validateBody(rfqReferenceSchema),
  ah(async (req: AuthRequest, res: Response) => {
    const id = bigIntParam(req.params.id);
    const b = req.body as import('@rfq/shared').RfqReferenceInput;
    const result = await buildReference(id, {
      outcome: b.outcome,
      actualCost: b.actualCost === undefined ? undefined : (b.actualCost ?? null),
    });
    if (result.skipped) return res.status(409).json({ error: result.skipped });
    res.json(result.reference);
  })
);

// --- Quotation: approve + generate (development.plan §7) -----------------
router.post(
  '/:id/quote',
  canEditRfq,
  ah(async (req: AuthRequest, res: Response) => {
    const id = bigIntParam(req.params.id);
    const version = await prisma.rfqVersion.findUnique({
      where: { id },
      include: { costSummary: true },
    });
    if (!version) notFound('RFQ version');
    if (!version!.costSummary) {
      return res.status(409).json({ error: 'Compute the cost before generating a quotation' });
    }

    await prisma.$transaction(async (tx) => {
      if (['DRAFT', 'COSTED'].includes(version!.status)) {
        await tx.rfqVersion.update({ where: { id }, data: { status: 'QUOTED' } });
      }
      await tx.rfq.update({
        where: { id: version!.rfqId },
        data: { status: 'QUOTED' },
      });
    });
    await buildReference(id, { outcome: 'QUOTED' });
    await audit(req, {
      entityType: 'RfqVersion',
      entityId: id,
      action: 'QUOTE',
      changes: {
        quotedPricePerPc: Number(version!.costSummary!.quotedPricePerPc),
        totalQuote: Number(version!.costSummary!.totalQuote),
        marginPct: Number(version!.costSummary!.marginPct),
        aiRecommendedMarginPct:
          version!.costSummary!.aiRecommendedMarginPct != null
            ? Number(version!.costSummary!.aiRecommendedMarginPct)
            : null,
      },
    });

    res.json({ version: await loadFull(id), quotation: await costSheetViewModel(id) });
  })
);

// --- Cost sheet: process lines (replace-all) -------------------------------
router.put(
  '/:id/processes',
  canEditRfq,
  validateBody(rfqProcessesSchema),
  ah(async (req: AuthRequest, res: Response) => {
    const id = bigIntParam(req.params.id);
    const { lines } = req.body as import('@rfq/shared').RfqProcessesInput;

    const version = await prisma.rfqVersion.findUnique({ where: { id } });
    if (!version) notFound('RFQ version');

    const processIds = [...new Set(lines.map((l) => BigInt(l.processId)))];
    const processes = await prisma.process.findMany({ where: { id: { in: processIds } } });
    const methodOf = new Map(processes.map((p) => [p.id.toString(), p.costingMethod]));

    await prisma.$transaction(async (tx) => {
      await tx.rfqProcess.deleteMany({ where: { rfqVersionId: id } });
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        await tx.rfqProcess.create({
          data: {
            rfqVersionId: id,
            processId: BigInt(l.processId),
            machineId: l.machineId ? BigInt(l.machineId) : null,
            method: l.method ?? methodOf.get(String(l.processId)) ?? 'FLAT_PC',
            quantityOrTime: l.quantityOrTime,
            rate: l.rate,
            cost: 0,
            sequence: l.sequence || i + 1,
          },
        });
      }
    });

    res.json(await loadFull(id));
  })
);

// --- Cost sheet: material line (set / clear) -----------------------------
router.put(
  '/:id/materials',
  canEditRfq,
  validateBody(rfqMaterialSchema),
  ah(async (req: AuthRequest, res: Response) => {
    const id = bigIntParam(req.params.id);
    const { line } = req.body as import('@rfq/shared').RfqMaterialInput;

    const version = await prisma.rfqVersion.findUnique({ where: { id } });
    if (!version) notFound('RFQ version');

    await prisma.$transaction(async (tx) => {
      await tx.rfqMaterial.deleteMany({ where: { rfqVersionId: id } });
      if (line) {
        const materialCost = line.inputWeightKg * (1 + line.wastagePct / 100) * line.ratePerKg;
        await tx.rfqMaterial.create({
          data: {
            rfqVersionId: id,
            materialSizeConfigId: BigInt(line.materialSizeConfigId),
            inputWeightKg: line.inputWeightKg,
            ratePerKg: line.ratePerKg,
            wastagePct: line.wastagePct,
            materialCost,
          },
        });
      }
    });

    res.json(await loadFull(id));
  })
);

// --- Cost engine: compute (§4) -----------------------------------------
router.post(
  '/:id/compute',
  canEditRfq,
  validateBody(computeRequestSchema),
  ah(async (req: AuthRequest, res: Response) => {
    const id = bigIntParam(req.params.id);
    const b = req.body as import('@rfq/shared').ComputeRequestInput;

    const resolved = await resolveEngineInput(id, {
      asOfDate: b.asOfDate,
      quantity: b.quantity,
      marginAdjustmentPct: b.marginAdjustmentPct,
      marginOverridePct: b.marginOverridePct ?? null,
    });
    if (!resolved) notFound('RFQ version');

    const summary = computeCost(resolved.input);

    if (b.persist) {
      await prisma.$transaction(async (tx) => {
        const row = summaryToRow(summary);
        await tx.rfqCostSummary.upsert({
          where: { rfqVersionId: id },
          create: { rfqVersionId: id, ...row },
          update: row,
        });
        for (const p of summary.processes) {
          if (!p.ref) continue;
          await tx.rfqProcess.update({
            where: { id: BigInt(p.ref) },
            data: { cost: p.cost, rate: p.rate, method: p.method },
          });
        }
        if (resolved.version.status === 'DRAFT') {
          await tx.rfqVersion.update({ where: { id }, data: { status: 'COSTED' } });
        }
      });
      await audit(req, {
        entityType: 'RfqCostSummary',
        entityId: id,
        action: 'COMPUTE',
        changes: {
          quotedPricePerPc: summary.quotedPricePerPc,
          totalQuote: summary.totalQuote,
          marginPctFinal: summary.marginPct,
          marginPctRecommended: summary.aiRecommendedMarginPct,
          overrideApplied: b.marginOverridePct != null,
        },
      });
    }

    res.json({
      summary,
      warnings: resolved.warnings,
      inputs: {
        asOfDate: resolved.input.asOfDate,
        quantity: resolved.input.quantity,
        batchQty: resolved.input.batchQty,
        customerRating: resolved.input.customerRating,
        baseMarginPct: resolved.input.baseMarginPct,
        adminPct: resolved.input.adminPct,
        materialRatePerKg: resolved.input.material?.ratePerKg ?? null,
      },
      version: b.persist ? await loadFull(id) : undefined,
    });
  })
);

export default router;
