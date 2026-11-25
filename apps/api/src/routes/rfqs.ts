import { Router, Response } from 'express';
import { rfqCreateSchema, rfqUpdateSchema, rfqVersionCreateSchema } from '@rfq/shared';
import { prisma } from '../lib/prisma.js';
import { authenticateToken, canEditRfq, userId, AuthRequest } from '../middleware/auth.js';
import { validateBody } from '../lib/validate.js';
import { ah, bigIntParam, notFound, badRequest } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { withRfqNumber } from '../lib/rfqNumber.js';
import { parsePaging, sendPage } from '../lib/paging.js';

const router = Router();
router.use(authenticateToken);

const versionInclude = {
  partAttributes: true,
  costSummary: true,
  reference: true,
} as const;

const rfqInclude = {
  customerPart: { include: { customer: true, productType: true } },
  versions: { orderBy: { revisionNo: 'asc' }, include: versionInclude },
} as const;

router.get(
  '/',
  ah(async (req: AuthRequest, res: Response) => {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const customerId = typeof req.query.customerId === 'string' ? req.query.customerId : undefined;

    const where = {
      ...(status ? { status } : {}),
      ...(customerId ? { customerPart: { customerId: BigInt(customerId) } } : {}),
      ...(search
        ? {
            OR: [
              { rfqNumber: { contains: search } },
              { customerPart: { customerPartNumber: { contains: search } } },
              { customerPart: { partName: { contains: search } } },
            ],
          }
        : {}),
    };
    const include = {
      customerPart: { include: { customer: true } },
      versions: {
        where: { isCurrent: true },
        include: { costSummary: true },
      },
    } as const;

    const paging = parsePaging(req.query);
    if (!paging) {
      return res.json(await prisma.rfq.findMany({ where, include, orderBy: { createdAt: 'desc' } }));
    }

    // Sortable columns -> how to order by them. Anything else is a 422 (the grid only offers these).
    const dir = paging.dir;
    const sorts: Record<string, object> = {
      rfqNumber: { rfqNumber: dir },
      rfqDate: { rfqDate: dir },
      requiredDate: { requiredDate: dir },
      status: { status: dir },
      createdAt: { createdAt: dir },
      customer: { customerPart: { customer: { code: dir } } },
      part: { customerPart: { customerPartNumber: dir } },
    };
    if (paging.sort && !(paging.sort in sorts)) badRequest(`Cannot sort RFQs by "${paging.sort}"`, 422);
    const orderBy = [paging.sort ? sorts[paging.sort] : { createdAt: 'desc' as const }, { id: 'desc' as const }];

    const [rfqs, total] = await Promise.all([
      prisma.rfq.findMany({ where, include, orderBy, skip: paging.skip, take: paging.take }),
      prisma.rfq.count({ where }),
    ]);
    sendPage(res, rfqs, total);
  })
);

router.get(
  '/:id',
  ah(async (req: AuthRequest, res: Response) => {
    const rfq = await prisma.rfq.findUnique({
      where: { id: bigIntParam(req.params.id) },
      include: rfqInclude,
    });
    if (!rfq) notFound('RFQ');
    res.json(rfq);
  })
);

router.get(
  '/:id/versions',
  ah(async (req: AuthRequest, res: Response) => {
    const versions = await prisma.rfqVersion.findMany({
      where: { rfqId: bigIntParam(req.params.id) },
      include: versionInclude,
      orderBy: { revisionNo: 'asc' },
    });
    res.json(versions);
  })
);

router.post(
  '/',
  canEditRfq,
  validateBody(rfqCreateSchema),
  ah(async (req: AuthRequest, res: Response) => {
    const b = req.body as import('@rfq/shared').RfqCreateInput;
    const uid = userId(req);

    const part = await prisma.customerPart.findUnique({ where: { id: BigInt(b.customerPartId) } });
    if (!part) notFound('Customer part');

    const rfq = await withRfqNumber(
      (rfqNumber) =>
      prisma.$transaction(async (tx) => {
        const created = await tx.rfq.create({
          data: {
            rfqNumber,
            customerPartId: BigInt(b.customerPartId),
            rfqDate: b.rfqDate,
            requiredDate: b.requiredDate ?? null,
            annualQty: b.annualQty ?? null,
            batchQty: b.batchQty ?? null,
            currency: b.currency,
            status: 'DRAFT',
            createdBy: uid,
          },
        });
        await tx.rfqVersion.create({
          data: {
            rfqId: created.id,
            revisionNo: 1,
            versionLabel: b.versionLabel ?? null,
            basedOnPartRevision: b.basedOnPartRevision ?? part!.currentRevision ?? null,
            status: 'DRAFT',
            isCurrent: true,
            createdBy: uid,
            partAttributes: { create: {} },
          },
        });
        return created;
      }),
      b.rfqNumber // explicit number (if any) is used as-is; otherwise auto-generated
    );

    await audit(req, { entityType: 'Rfq', entityId: rfq.id, action: 'CREATE', changes: { rfqNumber: rfq.rfqNumber, customerPartId: b.customerPartId } });
    const full = await prisma.rfq.findUnique({ where: { id: rfq.id }, include: rfqInclude });
    res.status(201).json(full);
  })
);

router.put(
  '/:id',
  canEditRfq,
  validateBody(rfqUpdateSchema),
  ah(async (req: AuthRequest, res: Response) => {
    const b = req.body as import('@rfq/shared').RfqUpdateInput;
    const id = bigIntParam(req.params.id);
    const rfq = await prisma.rfq.update({
      where: { id },
      data: {
        ...(b.requiredDate !== undefined ? { requiredDate: b.requiredDate ?? null } : {}),
        ...(b.annualQty !== undefined ? { annualQty: b.annualQty ?? null } : {}),
        ...(b.batchQty !== undefined ? { batchQty: b.batchQty ?? null } : {}),
        ...(b.currency ? { currency: b.currency } : {}),
        ...(b.status ? { status: b.status } : {}),
      },
      include: rfqInclude,
    });
    await audit(req, { entityType: 'Rfq', entityId: id, action: 'UPDATE', changes: req.body });
    res.json(rfq);
  })
);

router.post(
  '/:id/versions',
  canEditRfq,
  validateBody(rfqVersionCreateSchema),
  ah(async (req: AuthRequest, res: Response) => {
    const rfqId = bigIntParam(req.params.id);
    const b = req.body as import('@rfq/shared').RfqVersionCreateInput;
    const uid = userId(req);

    const rfq = await prisma.rfq.findUnique({ where: { id: rfqId } });
    if (!rfq) notFound('RFQ');

    const last = await prisma.rfqVersion.findFirst({
      where: { rfqId },
      orderBy: { revisionNo: 'desc' },
    });
    const revisionNo = (last?.revisionNo ?? 0) + 1;

    let attrData: Record<string, unknown> = {};
    if (b.copyFromVersionId) {
      const src = await prisma.rfqPartAttributes.findUnique({
        where: { rfqVersionId: BigInt(b.copyFromVersionId) },
      });
      if (src) {
        const { id: _id, rfqVersionId: _v, ...rest } = src;
        attrData = rest as Record<string, unknown>;
      }
    }

    const version = await prisma.$transaction(async (tx) => {
      await tx.rfqVersion.updateMany({ where: { rfqId }, data: { isCurrent: false } });
      return tx.rfqVersion.create({
        data: {
          rfqId,
          revisionNo,
          versionLabel: b.versionLabel ?? null,
          basedOnPartRevision: b.basedOnPartRevision ?? null,
          status: 'DRAFT',
          isCurrent: true,
          createdBy: uid,
          partAttributes: { create: attrData },
        },
        include: { partAttributes: true, costSummary: true },
      });
    });

    await audit(req, {
      entityType: 'RfqVersion',
      entityId: version.id,
      action: 'CREATE',
      changes: { rfqId: rfqId.toString(), revisionNo, copiedFrom: b.copyFromVersionId ?? null },
    });
    res.status(201).json(version);
  })
);

export default router;
