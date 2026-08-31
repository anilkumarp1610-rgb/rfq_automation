import { Router, Response } from 'express';
import bcrypt from 'bcrypt';
import { userCreateSchema, userUpdateSchema } from '@rfq/shared';
import { prisma } from '../lib/prisma.js';
import { authenticateToken, canManageUsers, userId, AuthRequest } from '../middleware/auth.js';
import { validateBody } from '../lib/validate.js';
import { ah, bigIntParam, notFound, badRequest } from '../lib/http.js';
import { audit } from '../lib/audit.js';

const router = Router();
router.use(authenticateToken, canManageUsers);

const shape = (u: {
  id: bigint;
  name: string;
  email: string;
  phone: string | null;
  isActive: boolean;
  createdAt: Date;
  roles: { role: { id: bigint; code: string; name: string } }[];
}) => ({
  id: u.id.toString(),
  name: u.name,
  email: u.email,
  phone: u.phone,
  isActive: u.isActive,
  createdAt: u.createdAt,
  role: u.roles[0]
    ? { id: u.roles[0].role.id.toString(), code: u.roles[0].role.code, name: u.roles[0].role.name }
    : null,
});

const withRoles = { roles: { include: { role: true } } } as const;

/** How many active administrators remain (guards against locking everyone out). */
async function activeAdminCount(): Promise<number> {
  return prisma.user.count({
    where: { isActive: true, roles: { some: { role: { code: 'ADMIN' } } } },
  });
}

router.get(
  '/',
  ah(async (_req: AuthRequest, res: Response) => {
    const users = await prisma.user.findMany({ include: withRoles, orderBy: { name: 'asc' } });
    res.json(users.map(shape));
  })
);

router.post(
  '/',
  validateBody(userCreateSchema),
  ah(async (req: AuthRequest, res: Response) => {
    const b = req.body as import('@rfq/shared').UserCreateInput;
    const email = b.email.toLowerCase();

    if (await prisma.user.findUnique({ where: { email } }))
      badRequest('That email is already registered', 409);
    const role = await prisma.role.findUnique({ where: { id: bigIntParam(b.roleId) } });
    if (!role) badRequest('Unknown role');

    const user = await prisma.user.create({
      data: {
        name: b.name,
        email,
        phone: b.phone ?? null,
        isActive: b.isActive,
        passwordHash: await bcrypt.hash(b.password, 10),
        roles: { create: { roleId: role!.id } },
      },
      include: withRoles,
    });
    await audit(req, {
      entityType: 'User',
      entityId: user.id,
      action: 'CREATE',
      changes: { email, name: b.name, role: role!.code, isActive: b.isActive },
    });
    res.status(201).json(shape(user));
  })
);

router.put(
  '/:id',
  validateBody(userUpdateSchema),
  ah(async (req: AuthRequest, res: Response) => {
    const id = bigIntParam(req.params.id);
    const b = req.body as import('@rfq/shared').UserUpdateInput;
    const email = b.email.toLowerCase();

    const existing = await prisma.user.findUnique({ where: { id }, include: withRoles });
    if (!existing) notFound('User');

    const clash = await prisma.user.findUnique({ where: { email } });
    if (clash && clash.id !== id) badRequest('That email is already registered', 409);

    const role = await prisma.role.findUnique({ where: { id: bigIntParam(b.roleId) } });
    if (!role) badRequest('Unknown role');

    const wasAdmin = existing!.roles.some((r) => r.role.code === 'ADMIN');
    const losingAdmin = (wasAdmin && role!.code !== 'ADMIN') || (existing!.isActive && !b.isActive);
    if (losingAdmin && wasAdmin && (await activeAdminCount()) <= 1)
      badRequest('This is the last active administrator — assign another admin first');
    if (id === userId(req) && !b.isActive) badRequest('You cannot deactivate your own account');

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          name: b.name,
          email,
          phone: b.phone ?? null,
          isActive: b.isActive,
          ...(b.password ? { passwordHash: await bcrypt.hash(b.password, 10) } : {}),
        },
      });
      await tx.userRole.deleteMany({ where: { userId: id } });
      await tx.userRole.create({ data: { userId: id, roleId: role!.id } });
    });

    const updated = await prisma.user.findUnique({ where: { id }, include: withRoles });
    await audit(req, {
      entityType: 'User',
      entityId: id,
      action: 'UPDATE',
      changes: {
        email,
        name: b.name,
        role: role!.code,
        isActive: b.isActive,
        passwordChanged: !!b.password,
      },
    });
    res.json(shape(updated!));
  })
);

/** Soft-delete — deactivate. */
router.delete(
  '/:id',
  ah(async (req: AuthRequest, res: Response) => {
    const id = bigIntParam(req.params.id);
    if (id === userId(req)) badRequest('You cannot delete your own account');

    const existing = await prisma.user.findUnique({ where: { id }, include: withRoles });
    if (!existing) notFound('User');

    const isAdmin = existing!.roles.some((r) => r.role.code === 'ADMIN');
    if (isAdmin && existing!.isActive && (await activeAdminCount()) <= 1)
      badRequest('This is the last active administrator');

    await prisma.user.update({ where: { id }, data: { isActive: false } });
    await audit(req, { entityType: 'User', entityId: id, action: 'DELETE', changes: { email: existing!.email } });
    res.status(204).end();
  })
);

export default router;
