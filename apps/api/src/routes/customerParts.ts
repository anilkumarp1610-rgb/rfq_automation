import { Router, Response } from 'express';
import { customerPartSchema } from '@rfq/shared';
import { prisma } from '../lib/prisma.js';
import { authenticateToken, canEditRfq, AuthRequest } from '../middleware/auth.js';
import { validateBody } from '../lib/validate.js';
import { ah, bigIntParam, notFound, withBigInts } from '../lib/http.js';
import { audit } from '../lib/audit.js';

const router = Router();
router.use(authenticateToken);

const fkFields = ['customerId', 'productTypeId'] as const;

router.get(
  '/',
  ah(async (req: AuthRequest, res: Response) => {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const customerId = typeof req.query.customerId === 'string' ? req.query.customerId : undefined;
    const parts = await prisma.customerPart.findMany({
      where: {
        ...(customerId ? { customerId: BigInt(customerId) } : {}),
        ...(search
          ? {
              OR: [
                { customerPartNumber: { contains: search } },
                { partName: { contains: search } },
                { drawingNo: { contains: search } },
              ],
            }
          : {}),
      },
      include: { customer: true, productType: true, _count: { select: { rfqs: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    res.json(parts);
  })
);

router.get(
  '/:id',
  ah(async (req: AuthRequest, res: Response) => {
    const part = await prisma.customerPart.findUnique({
      where: { id: bigIntParam(req.params.id) },
      include: {
        customer: true,
        productType: true,
        rfqs: { include: { versions: true } },
        specAnalyses: { orderBy: { revision: 'asc' } },
      },
    });
    if (!part) notFound('Customer part');
    res.json(part);
  })
);

router.get(
  '/:id/specs',
  ah(async (req: AuthRequest, res: Response) => {
    const specs = await prisma.specAnalysis.findMany({
      where: { customerPartId: bigIntParam(req.params.id) },
      include: { items: true },
      orderBy: { revision: 'asc' },
    });
    res.json(specs);
  })
);

router.post(
  '/',
  canEditRfq,
  validateBody(customerPartSchema),
  ah(async (req: AuthRequest, res: Response) => {
    const part = await prisma.customerPart.create({
      data: withBigInts(req.body, [...fkFields]) as never,
      include: { customer: true, productType: true },
    });
    await audit(req, { entityType: 'CustomerPart', entityId: part.id, action: 'CREATE', changes: req.body });
    res.status(201).json(part);
  })
);

router.put(
  '/:id',
  canEditRfq,
  validateBody(customerPartSchema),
  ah(async (req: AuthRequest, res: Response) => {
    const id = bigIntParam(req.params.id);
    const part = await prisma.customerPart.update({
      where: { id },
      data: withBigInts(req.body, [...fkFields]) as never,
      include: { customer: true, productType: true },
    });
    await audit(req, { entityType: 'CustomerPart', entityId: id, action: 'UPDATE', changes: req.body });
    res.json(part);
  })
);

export default router;
