import { Router, Response } from 'express';
import { similarQuerySchema } from '@rfq/shared';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { validateQuery } from '../lib/validate.js';
import { ah, badRequest, notFound } from '../lib/http.js';
import { findSimilar, targetFromPart, targetFromVersion } from '../reference/similar.js';

const router = Router();
router.use(authenticateToken);

// GET /reference/similar?partId=… | versionId=… [&limit=]
router.get(
  '/similar',
  validateQuery(similarQuerySchema),
  ah(async (_req: AuthRequest, res: Response) => {
    const q = res.locals.query as import('@rfq/shared').SimilarQueryInput;
    if (!q.partId && !q.versionId) badRequest('Provide partId or versionId');

    const target = q.versionId
      ? await targetFromVersion(BigInt(q.versionId))
      : await targetFromPart(BigInt(q.partId!));
    if (!target) notFound(q.versionId ? 'RFQ version' : 'Customer part');

    const matches = await findSimilar(target!, q.limit);
    res.json({ target: serializeTarget(target!), matches });
  })
);

function serializeTarget(t: NonNullable<Awaited<ReturnType<typeof targetFromPart>>>) {
  return {
    productTypeId: t.productTypeId?.toString() ?? null,
    materialCategoryId: t.materialCategoryId?.toString() ?? null,
    dims: t.dims,
  };
}

export default router;
