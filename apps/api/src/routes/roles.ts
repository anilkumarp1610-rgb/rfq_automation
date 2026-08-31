import { Router, Response } from 'express';
import { roleCreateSchema, roleUpdateSchema } from '@rfq/shared';
import { prisma } from '../lib/prisma.js';
import { authenticateToken, canManageUsers, AuthRequest } from '../middleware/auth.js';
import { validateBody } from '../lib/validate.js';
import { ah, bigIntParam, notFound, badRequest } from '../lib/http.js';
import { audit } from '../lib/audit.js';

const router = Router();
router.use(authenticateToken);

const shape = (r: {
  id: bigint;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  _count: { roles: number };
}) => ({
  id: r.id.toString(),
  code: r.code,
  name: r.name,
  description: r.description,
  isSystem: r.isSystem,
  userCount: r._count.roles,
});

// Any authenticated user can read the catalogue (the user form needs it).
router.get(
  '/',
  ah(async (_req: AuthRequest, res: Response) => {
    const roles = await prisma.role.findMany({
      include: { _count: { select: { roles: true } } },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });
    res.json(roles.map(shape));
  })
);

router.post(
  '/',
  canManageUsers,
  validateBody(roleCreateSchema),
  ah(async (req: AuthRequest, res: Response) => {
    const b = req.body as import('@rfq/shared').RoleCreateInput;
    if (await prisma.role.findUnique({ where: { code: b.code } }))
      badRequest('A role with that code already exists', 409);

    const role = await prisma.role.create({
      data: { code: b.code, name: b.name, description: b.description ?? null, isSystem: false },
      include: { _count: { select: { roles: true } } },
    });
    await audit(req, {
      entityType: 'Role',
      entityId: role.id,
      action: 'CREATE',
      changes: { code: b.code, name: b.name },
    });
    res.status(201).json(shape(role));
  })
);

router.put(
  '/:id',
  canManageUsers,
  validateBody(roleUpdateSchema),
  ah(async (req: AuthRequest, res: Response) => {
    const id = bigIntParam(req.params.id);
    const b = req.body as import('@rfq/shared').RoleUpdateInput;
    if (!(await prisma.role.findUnique({ where: { id } }))) notFound('Role');

    const role = await prisma.role.update({
      where: { id },
      data: { name: b.name, description: b.description ?? null },
      include: { _count: { select: { roles: true } } },
    });
    await audit(req, {
      entityType: 'Role',
      entityId: id,
      action: 'UPDATE',
      changes: { name: b.name, description: b.description ?? null },
    });
    res.json(shape(role));
  })
);

// Roles are never deleted — deactivate the users that hold a role instead.
router.delete('/:id', canManageUsers, (_req, res) => {
  res.status(405).json({ error: 'Roles cannot be deleted' });
});

export default router;
