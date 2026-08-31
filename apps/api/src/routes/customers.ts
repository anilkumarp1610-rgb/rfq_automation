import { Router, Response } from 'express';
import { customerSchema } from '@rfq/shared';
import { prisma } from '../lib/prisma.js';
import { authenticateToken, canEditMasters, AuthRequest } from '../middleware/auth.js';
import { validateBody } from '../lib/validate.js';
import { ah, bigIntParam, notFound } from '../lib/http.js';

const router = Router();
router.use(authenticateToken);

router.get(
  '/',
  ah(async (req: AuthRequest, res: Response) => {
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const activeOnly = req.query.activeOnly !== 'false';
    const customers = await prisma.customer.findMany({
      where: {
        ...(activeOnly ? { isActive: true } : {}),
        ...(search
          ? { OR: [{ name: { contains: search } }, { code: { contains: search } }] }
          : {}),
      },
      orderBy: { name: 'asc' },
    });
    res.json(customers);
  })
);

router.get(
  '/:id',
  ah(async (req: AuthRequest, res: Response) => {
    const customer = await prisma.customer.findUnique({
      where: { id: bigIntParam(req.params.id) },
      include: { parts: true },
    });
    if (!customer) notFound('Customer');
    res.json(customer);
  })
);

router.post(
  '/',
  canEditMasters,
  validateBody(customerSchema),
  ah(async (req: AuthRequest, res: Response) => {
    const customer = await prisma.customer.create({ data: req.body });
    res.status(201).json(customer);
  })
);

router.put(
  '/:id',
  canEditMasters,
  validateBody(customerSchema),
  ah(async (req: AuthRequest, res: Response) => {
    const customer = await prisma.customer.update({
      where: { id: bigIntParam(req.params.id) },
      data: req.body,
    });
    res.json(customer);
  })
);

router.delete(
  '/:id',
  canEditMasters,
  ah(async (req: AuthRequest, res: Response) => {
    await prisma.customer.update({
      where: { id: bigIntParam(req.params.id) },
      data: { isActive: false },
    });
    res.status(204).end();
  })
);

export default router;
