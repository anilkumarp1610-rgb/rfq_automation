import { Router, Response } from 'express';
import { authenticateToken, requireRole, AuthRequest } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';
import { ah } from '../lib/http.js';

const router = Router();
router.use(authenticateToken, requireRole('ADMIN', 'MANAGER'));

// GET /audit-log?entityType=&entityId=&action=&limit=
router.get(
  '/',
  ah(async (req: AuthRequest, res: Response) => {
    const { entityType, entityId, action } = req.query as Record<string, string | undefined>;
    const limit = Math.min(Number(req.query.limit) || 100, 500);

    const rows = await prisma.auditLog.findMany({
      where: {
        ...(entityType ? { entityType } : {}),
        ...(entityId && /^\d+$/.test(entityId) ? { entityId: BigInt(entityId) } : {}),
        ...(action ? { action } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    const userIds = [...new Set(rows.map((r) => r.createdBy).filter((v): v is bigint => v != null))];
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true },
    });
    const byUser = new Map(users.map((u) => [u.id.toString(), u]));

    res.json(
      rows.map((r) => ({
        id: r.id.toString(),
        entityType: r.entityType,
        entityId: r.entityId.toString(),
        action: r.action,
        changes: safeParse(r.changes),
        createdAt: r.createdAt.toISOString(),
        by: r.createdBy ? (byUser.get(r.createdBy.toString()) ?? null) : null,
      }))
    );
  })
);

function safeParse(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

export default router;
